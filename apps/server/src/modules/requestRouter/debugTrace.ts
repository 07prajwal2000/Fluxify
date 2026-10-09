import type { TraceSpanRecord } from "@fluxify/common/otlp";

/**
 * A short trace of the run, for the admin's debug call only (#704). Same
 * token gate as the debug error (#671); a public caller never gets it.
 * It is a hint, not the record: `get_recording` holds the full run.
 */
export const DEBUG_TRACE_HEADER = "x-fluxify-debug-trace";
export const MAX_DEBUG_TRACE_HEADER = 4_096;
const MAX_OUTPUT = 240;
const MAX_ERROR = 300;
/** base64 spends 4 chars per 3 bytes; the rest is the `more` count */
const BUDGET = Math.floor((MAX_DEBUG_TRACE_HEADER * 3) / 4) - 40;

export type DebugTraceSpan = {
	blockId: string;
	blockType: string;
	blockName?: string;
	outcome: "success" | "failure";
	ms: number;
	/** the block's output as JSON text, cut */
	output?: string;
	error?: string;
};

export type DebugTrace = {
	spans: DebugTraceSpan[];
	/** blocks that ran but did not fit */
	more?: number;
};

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

function entry(span: TraceSpanRecord): DebugTraceSpan {
	const output = span.output === undefined ? undefined : JSON.stringify(span.output);
	return {
		blockId: span.blockId,
		blockType: span.blockType,
		...(span.blockName ? { blockName: span.blockName } : {}),
		outcome: span.outcome,
		ms: Math.round(span.endedAt - span.startedAt),
		...(output === undefined ? {} : { output: cut(output, MAX_OUTPUT) }),
		...(span.error ? { error: cut(span.error, MAX_ERROR) } : {}),
	};
}

/**
 * The route's own blocks in run order, as many as fit in the header. Blocks
 * inside a custom block are left out: their ids belong to another canvas.
 */
export function encodeDebugTrace(spans: TraceSpanRecord[]) {
	const own = spans.filter((s) => s.parentSeq === undefined).sort((a, b) => a.seq - b.seq);
	const kept: DebugTraceSpan[] = [];
	let size = 0;
	for (const span of own) {
		const next = entry(span);
		size += Buffer.byteLength(JSON.stringify(next)) + 1;
		if (size > BUDGET) break;
		kept.push(next);
	}
	const more = own.length - kept.length;
	const trace: DebugTrace = { spans: kept, ...(more ? { more } : {}) };
	return Buffer.from(JSON.stringify(trace)).toString("base64url");
}

export function decodeDebugTrace(value: string | null): DebugTrace | undefined {
	if (!value) return;
	try {
		const parsed = JSON.parse(Buffer.from(value, "base64url").toString());
		return Array.isArray(parsed?.spans) ? parsed : undefined;
	} catch {
		return;
	}
}
