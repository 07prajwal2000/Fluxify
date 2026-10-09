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

/** What the model needs to act on a failure: the route's answer, a failing test, any tool error. */
const neverTrim = (tool: string, output: any) =>
	output?.type === "error-text" ||
	output?.type === "error-json" ||
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
	const newest = new Map<string, string>();
	const onCanvas = new Set<string>();
	const schemas: { id: string; types: string[] }[] = [];
	for (const m of messages) {
		if (m.role !== "tool") continue;
		for (const p of m.content) {
			if (p.type !== "tool-result") continue;
			const input = calls.get(p.toolCallId)?.input;
			if (CANVAS.has(p.toolName))
				newest.set(`${p.toolName} ${input?.target?.kind} ${input?.target?.id}`, p.toolCallId);
			if (p.toolName === "get_canvas")
				for (const b of parsed(p.output)?.blocks ?? []) onCanvas.add(b.type);
			if (p.toolName === "get_block_schemas")
				schemas.push({ id: p.toolCallId, types: input?.blockTypes ?? [] });
		}
	}
	for (const call of calls.values())
		if (call.toolName === "edit_canvas")
			for (const op of call.input?.ops ?? []) if (op?.op === "add_block") onCanvas.add(op.type);
	const keep = new Set(newest.values());
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
		if (m.role !== "tool" || i >= from) return m;
		return {
			...m,
			content: m.content.map((p) => {
				if (p.type !== "tool-result") return p;
				const n = chars(p.output);
				const kept = keep.has(p.toolCallId) || neverTrim(p.toolName, p.output);
				let value: string;
				if (kept) {
					if (n <= HUGE_CHARS || CANVAS.has(p.toolName)) return p;
					value = headTail(body(p.output), n);
				} else {
					if (n < MIN_TRIM_CHARS || (level < 1 && !isFirst(p.toolName))) return p;
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
