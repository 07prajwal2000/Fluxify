import type { ModelMessage } from "ai";
import { chars } from "./compactStats";

/** Shorter results are not worth a stub. */
const MIN_TRIM_CHARS = 500;
/** A result that is never trimmed but is bigger than this keeps only its start and end. */
const HUGE_CHARS = 20_000;
const EDGE = 4_000;
const CANVAS = new Set(["get_canvas", "edit_canvas"]);
/** Results that go first: big dumps the model has already read and rarely needs again. */
const FIRST = new Set(["get_recording", "get_system_logs", "search_docs", "read_doc", "list"]);
const isFirst = (tool: string) => FIRST.has(tool) || tool.startsWith("list_");

/** 0: only the first class is trimmed. 1: the other results too. Never-trim results stay at both. */
export type TrimLevel = 0 | 1;

type Call = { toolName: string; input: any };
const callsOf = (messages: ModelMessage[]) => {
	const calls = new Map<string, Call>();
	for (const m of messages)
		if (m.role === "assistant" && typeof m.content !== "string")
			for (const p of m.content)
				if (p.type === "tool-call")
					calls.set(p.toolCallId, { toolName: p.toolName, input: p.input });
	return calls;
};

const body = (o: any) => o?.value ?? o;
const text = (v: unknown) => (typeof v === "string" ? v : (JSON.stringify(v) ?? ""));
const parsed = (o: unknown) => {
	const v = body(o);
	if (typeof v !== "string") return v;
	try {
		return JSON.parse(v);
	} catch {
		return v;
	}
};

const TEST_RESULTS = new Set(["run_test_suite", "get_test_runs"]);
const FAILED_TEST = /"failedChecks":\[\s*"|"status":"(?:failed|error)"|"failedCount":[1-9]/;

const isError = (output: any) => output?.type === "error-text" || output?.type === "error-json";

/** What the model needs to act on a failure: the route's answer, a failing test, any tool error. */
const neverTrim = (tool: string, output: any) =>
	isError(output) ||
	tool === "call_route" ||
	(TEST_RESULTS.has(tool) && FAILED_TEST.test(text(body(output))));

/** "list" and "get" stand for list_routes, get_route, ...: name the one that ran. */
const labelOf = (tool: string, input: any) =>
	(tool === "list" || tool === "get") && typeof input?.type === "string"
		? `${tool}_${input.type}`
		: tool;

/**
 * Tool call ids whose results depend on what came later, so they are decided once
 * (at the batch, not on every step): the newest get_canvas and edit_canvas result of
 * each target, and the get_block_schemas results for block types that are on a canvas.
 */
export function keepSet(messages: ModelMessage[]) {
	const calls = callsOf(messages);
	const onCanvas = new Set<string>();
	const schemas: { id: string; types: string[] }[] = [];

	type CanvasEntry = { id: string; tool: string; success: boolean; index: number };
	const byTarget = new Map<string, CanvasEntry[]>();

	let toolCallIndex = 0;
	for (const m of messages) {
		if (m.role !== "tool") continue;
		for (const p of m.content) {
			if (p.type !== "tool-result") continue;
			toolCallIndex++;
			const input = calls.get(p.toolCallId)?.input;
			if (CANVAS.has(p.toolName) && input?.target?.kind && input?.target?.id) {
				const targetKey = `${input.target.kind} ${input.target.id}`;
				const list = byTarget.get(targetKey) ?? [];
				list.push({
					id: p.toolCallId,
					tool: p.toolName,
					success: !isError(p.output),
					index: toolCallIndex,
				});
				byTarget.set(targetKey, list);
			}
			if (p.toolName === "get_canvas")
				for (const b of parsed(p.output)?.blocks ?? []) onCanvas.add(b.type);
			if (p.toolName === "get_block_schemas")
				schemas.push({ id: p.toolCallId, types: input?.blockTypes ?? [] });
		}
	}
	for (const call of calls.values())
		if (call.toolName === "edit_canvas")
			for (const op of call.input?.ops ?? []) if (op?.op === "add_block") onCanvas.add(op.type);

	const keep = new Set<string>();
	for (const entries of byTarget.values()) {
		const edits = entries.filter((e) => e.tool === "edit_canvas");
		const gets = entries.filter((e) => e.tool === "get_canvas");

		const lastSuccessfulEdit = edits.findLast((e) => e.success);
		const lastEdit = edits.at(-1);

		if (lastSuccessfulEdit) {
			keep.add(lastSuccessfulEdit.id);
			const postEditGet = gets.findLast((g) => g.index > lastSuccessfulEdit.index);
			if (postEditGet) keep.add(postEditGet.id);
		} else if (lastEdit) {
			keep.add(lastEdit.id);
			const lastGet = gets.at(-1);
			if (lastGet) keep.add(lastGet.id);
		} else {
			const lastGet = gets.at(-1);
			if (lastGet) keep.add(lastGet.id);
		}
	}

	for (const s of schemas) if (s.types.some((t) => onCanvas.has(t))) keep.add(s.id);
	return keep;
}

/** The start and the end of a result that is too big to keep whole. */
const headTail = (value: unknown, n: number) => {
	const s = text(value);
	return `${s.slice(0, EDGE)}\n[… ${n - 2 * EDGE} chars trimmed …]\n${s.slice(-EDGE)}`;
};

/**
 * 60%: a copy of `messages` with big tool results before index `from` replaced by
 * a stub. First class first (`level` 0), then the rest too (1). Never trimmed:
 * call_route answers, failing test results, any tool error, and what `keep` names
 * (see keepSet); one of those that is huge keeps head and tail. Same input, same
 * output; `messages` is not changed.
 */
export function trimOld(
	messages: ModelMessage[],
	from: number,
	{ keep = new Set<string>(), level = 1 }: { keep?: Set<string>; level?: TrimLevel } = {},
) {
	const calls = callsOf(messages);
	const tools: Record<string, number> = {};
	let results = 0;
	const out = messages.map((m, i): ModelMessage => {
		if (i >= from) return m;

		if (m.role === "assistant" && typeof m.content !== "string") {
			let changed = false;
			const content = m.content.map((p) => {
				if (p.type !== "tool-call" || p.toolName !== "edit_canvas") return p;
				if (keep.has(p.toolCallId)) return p;
				const input = p.input as { ops?: unknown[] } | null | undefined;
				if (!input?.ops || (Array.isArray(input.ops) && input.ops.length === 0)) return p;
				changed = true;
				return {
					...p,
					input: { ...input, ops: [] },
				};
			});
			return changed ? { ...m, content } : m;
		}

		if (m.role !== "tool") return m;
		return {
			...m,
			content: m.content.map((p) => {
				if (p.type !== "tool-result") return p;
				const n = chars(p.output);
				const isCanvas = CANVAS.has(p.toolName);
				const kept = isCanvas
					? keep.has(p.toolCallId)
					: keep.has(p.toolCallId) || neverTrim(p.toolName, p.output);
				let value: string;
				if (kept) {
					if (n <= HUGE_CHARS || isCanvas) return p;
					value = headTail(body(p.output), n);
				} else {
					if (!isCanvas && (n < MIN_TRIM_CHARS || (level < 1 && !isFirst(p.toolName)))) return p;
					value = `[result trimmed: ${p.toolName}, ${n} chars]`;
				}
				const label = labelOf(p.toolName, calls.get(p.toolCallId)?.input);
				tools[label] = (tools[label] ?? 0) + 1;
				results++;
				return { ...p, output: { type: "text" as const, value } };
			}),
		};
	});
	return { messages: out, results, tools };
}
