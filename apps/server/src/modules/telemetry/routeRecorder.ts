import type { BlockTrace, BlockTraceSpan, CustomBlockScope } from "@fluxify/blocks";
import type { TraceRunPayload, TraceSpanRecord } from "@fluxify/common/otlp";

const MAX_SPANS_PER_RUN = 1_000;
const MAX_RUN_BYTES = 256 * 1024;
const MAX_VALUE_BYTES = 8 * 1024;

export type RecordedRoute = {
	projectId: string;
	routeId: string;
	routeVersion: string;
	method: string;
	path: string;
};

export type TraceOutcome = "success" | "failure";

export type RequestTrace = BlockTrace & {
	complete(outcome: TraceOutcome, statusCode?: number): void;
};

type TraceScope = {
	parentSeq?: number;
	customBlockId?: string;
};

type TraceState = {
	nextSeq: number;
	spans: TraceSpanRecord[];
	pendingInvocations: Map<string, number[]>;
	bytes: number;
	droppedSpans: number;
	truncated: boolean;
};

/**
 * A request-local span buffer. It has no broker connection and no credentials:
 * its only side effect is handing a completed, bounded payload to its owner.
 */
export class RouteTraceRecorder implements RequestTrace {
	readonly runId = crypto.randomUUID();
	private readonly startedAtWallMs = Date.now();
	private readonly perfOrigin = performance.now();
	private readonly state: TraceState = {
		nextSeq: 0,
		spans: [],
		pendingInvocations: new Map(),
		bytes: 0,
		droppedSpans: 0,
		truncated: false,
	};
	private completed = false;

	constructor(
		private readonly route: RecordedRoute,
		private readonly onComplete: (run: TraceRunPayload) => void,
		private readonly parent?: { runId: string; seq: number },
	) {}

	recordSpan(span: BlockTraceSpan): void {
		this.record(span, {});
	}

	enterCustomBlock(invocation: {
		blockId: string;
		name: string;
		detached: boolean;
	}): CustomBlockScope {
		return this.enter(invocation, {});
	}

	complete(outcome: TraceOutcome, statusCode?: number): void {
		if (this.completed) return;
		this.completed = true;

		const run: TraceRunPayload = {
			runId: this.runId,
			projectId: this.route.projectId,
			routeId: this.route.routeId,
			routeVersion: this.route.routeVersion,
			method: this.route.method,
			path: this.route.path,
			startedAtWallMs: this.startedAtWallMs,
			perfOrigin: this.perfOrigin,
			endedAt: performance.now(),
			outcome,
			...(statusCode === undefined ? {} : { statusCode }),
			...(this.state.truncated ? { truncated: true } : {}),
			...(this.state.droppedSpans > 0
				? { droppedSpans: this.state.droppedSpans }
				: {}),
			...(this.parent
				? { parentRunId: this.parent.runId, parentSeq: this.parent.seq }
				: {}),
			spans: this.state.spans,
		};

		try {
			this.onComplete(run);
		} catch {
			// Sending telemetry must never affect a route response.
		}
	}

	private enter(
		invocation: { blockId: string; name: string; detached: boolean },
		scope: TraceScope,
	): CustomBlockScope {
		const seq = this.state.nextSeq++;
		const pending = this.state.pendingInvocations.get(invocation.blockId) ?? [];
		pending.push(seq);
		this.state.pendingInvocations.set(invocation.blockId, pending);

		if (invocation.detached) {
			const detached = new RouteTraceRecorder(
				this.route,
				this.onComplete,
				{ runId: this.runId, seq },
			);
			return {
				trace: detached,
				close: (outcome: TraceOutcome = "success", error?: unknown) => {
					void error;
					detached.complete(outcome);
				},
			};
		}

		const nested = new NestedTrace(this, {
			parentSeq: seq,
		});
		return { trace: nested, close: () => {} };
	}

	private record(span: BlockTraceSpan, scope: TraceScope): void {
		if (this.completed || this.state.spans.length >= MAX_SPANS_PER_RUN) {
			this.drop();
			return;
		}

		const pending = this.state.pendingInvocations.get(span.blockId);
		const seq = pending?.shift() ?? this.state.nextSeq++;
		if (pending?.length === 0) this.state.pendingInvocations.delete(span.blockId);

		const input = safeValue(span.input);
		const output = safeValue(span.output);
		const record: TraceSpanRecord = {
			seq,
			...(scope.parentSeq === undefined ? {} : { parentSeq: scope.parentSeq }),
			blockId: span.blockId,
			blockType: span.blockType,
			...(scope.customBlockId ? { customBlockId: scope.customBlockId } : {}),
			startedAt: span.startedAt,
			endedAt: span.endedAt,
			outcome: span.outcome,
			...(span.branch ? { branch: span.branch } : {}),
			...(input.value === undefined ? {} : { input: input.value }),
			...(output.value === undefined ? {} : { output: output.value }),
			...(span.error === undefined ? {} : { error: String(span.error) }),
			...(input.truncated || output.truncated ? { truncated: true } : {}),
		};
		const bytes = byteLength(record);
		if (this.state.bytes + bytes > MAX_RUN_BYTES) {
			this.drop();
			return;
		}
		this.state.bytes += bytes;
		this.state.spans.push(record);
		if (record.truncated) this.state.truncated = true;
	}

	private drop() {
		this.state.droppedSpans++;
		this.state.truncated = true;
	}

	/** Internal bridge for nested compiled custom blocks. */
	_nestedRecord(span: BlockTraceSpan, scope: TraceScope) {
		this.record(span, scope);
	}

	/** Internal bridge for nested compiled custom blocks. */
	_nestedEnter(
		invocation: { blockId: string; name: string; detached: boolean },
		scope: TraceScope,
	) {
		return this.enter(invocation, scope);
	}
}

class NestedTrace implements BlockTrace {
	constructor(
		private readonly owner: RouteTraceRecorder,
		private readonly scope: TraceScope,
	) {}

	recordSpan(span: BlockTraceSpan): void {
		this.owner._nestedRecord(span, this.scope);
	}

	enterCustomBlock(invocation: {
		blockId: string;
		name: string;
		detached: boolean;
	}): CustomBlockScope {
		return this.owner._nestedEnter(invocation, this.scope);
	}
}

function safeValue(value: unknown): { value: unknown; truncated: boolean } {
	if (value === undefined) return { value: undefined, truncated: false };
	const seen = new WeakSet<object>();
	let text: string | undefined;
	try {
		text = JSON.stringify(value, (_key, item) => {
			if (typeof item === "bigint") return item.toString();
			if (item instanceof Error) return String(item);
			if (typeof item === "function" || typeof item === "symbol") return String(item);
			if (item && typeof item === "object") {
				if (seen.has(item)) return "[Circular]";
				seen.add(item);
			}
			return item;
		});
	} catch {
		text = JSON.stringify(String(value));
	}
	if (text === undefined) return { value: String(value), truncated: false };
	if (byteLength(text) > MAX_VALUE_BYTES) {
		return {
			value: `${text.slice(0, MAX_VALUE_BYTES)}…`,
			truncated: true,
		};
	}
	try {
		return { value: JSON.parse(text), truncated: false };
	} catch {
		return { value: text, truncated: false };
	}
}

function byteLength(value: unknown) {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
