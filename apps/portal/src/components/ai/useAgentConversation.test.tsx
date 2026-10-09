import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import type { AgentEvent } from "@fluxify/ai-gateway/src/agent/runner/events";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

/** Records every stream the hook opens; `emit` plays a server event. */
class FakeEventSource {
	static all: FakeEventSource[] = [];
	listeners: Record<string, ((m: { data: string }) => void)[]> = {};
	onerror: (() => void) | null = null;
	closed = false;
	constructor(public url: string) {
		FakeEventSource.all.push(this);
	}
	addEventListener(type: string, f: (m: { data: string }) => void) {
		this.listeners[type] ??= [];
		this.listeners[type].push(f);
	}
	close() {
		this.closed = true;
	}
	emit(e: AgentEvent) {
		for (const f of this.listeners[e.type] ?? []) f({ data: JSON.stringify(e) });
	}
}
globalThis.EventSource = FakeEventSource as never;

const { act, cleanup, renderHook } = await import("@testing-library/react");

/** Not RTL's waitFor: it stays bound to the DOM of whichever test file loaded RTL first. */
async function waitFor(check: () => void, { timeout = 1000 } = {}) {
	const end = Date.now() + timeout;
	for (;;) {
		try {
			return check();
		} catch (e) {
			if (Date.now() > end) throw e;
			await act(() => new Promise((r) => setTimeout(r, 20)));
		}
	}
}
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { agentConversationsService } = await import("@/services/agentConversations");
const { useAgentConversation } = await import("./useAgentConversation");

type Row = { seq: number; role: string; runId: string; content: unknown; createdAt?: string };
const user = (seq: number, text: string): Row => ({
	seq,
	role: "user",
	runId: "r1",
	content: { role: "user", content: text },
});
const assistant = (seq: number, content: unknown[]): Row => ({
	seq,
	role: "assistant",
	runId: "r1",
	content: { role: "assistant", content },
});
const toolRow = (seq: number, id: string, value: unknown): Row => ({
	seq,
	role: "tool",
	runId: "r1",
	content: {
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId: id,
				toolName: "get_route",
				output: { type: "json", value },
			},
		],
	},
});
const detail = (
	messages: Row[],
	status: string,
	stopReason: string | null = null,
	nextBeforeSeq: number | null = null,
) => ({
	conversation: { id: "c1", title: "t", archived: false } as never,
	messages,
	nextBeforeSeq,
	run: { id: "r1", status, stopReason } as never,
	settings: { mode: "manual", effort: "none", supportsThinking: false },
});

let get: ReturnType<typeof spyOn>;
beforeEach(() => {
	FakeEventSource.all = [];
	get = spyOn(agentConversationsService, "get");
});
afterEach(() => {
	cleanup();
	get.mockRestore();
});
afterAll(() => GlobalRegistrator.unregister());

function setup() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return renderHook(() => useAgentConversation("p1", "c1"), { wrapper });
}
const stream = async (n = 1) => {
	await waitFor(() => expect(FakeEventSource.all.length).toBe(n), { timeout: 3000 });
	return FakeEventSource.all[n - 1];
};
const texts = (m: { parts: { type: string; text?: string }[] }[]) =>
	m.flatMap((x) => x.parts.filter((p) => p.type === "text").map((p) => p.text));

test("an active run streams from the highest saved seq into an in-progress message", async () => {
	get.mockResolvedValue(detail([user(0, "build it")], "executing"));
	const { result } = setup();
	const es = await stream();
	expect(es.url).toEndWith("/ai/v1/agent/runs/r1/stream?afterSeq=0");
	act(() => {
		es.emit({ type: "reasoning", seq: 1, text: "hmm" });
		es.emit({ type: "text", seq: 1, text: "Hel" });
		es.emit({ type: "text", seq: 1, text: "lo" });
		es.emit({
			type: "tool-start",
			seq: 1,
			toolCallId: "t1",
			toolName: "get_route",
			toolTitle: "Get route",
			input: { id: 1 },
		});
		es.emit({
			type: "tool-end",
			seq: 2,
			toolCallId: "t1",
			toolName: "get_route",
			status: "done",
			output: "ok",
		});
	});
	expect(result.current.running).toBe(true);
	const live = result.current.messages[1];
	expect(live.parts.map((p) => p.type)).toEqual(["reasoning", "text", "tool"]);
	expect(live.parts[1]).toEqual({ type: "text", text: "Hello" });
	expect(live.parts[2]).toMatchObject({
		name: "get_route",
		title: "Get route",
		status: "done",
		output: "ok",
	});
});

test("a tool-end for a call saved before the run (approved or rejected) lands on its saved row", async () => {
	get.mockResolvedValue(
		detail(
			[
				user(0, "build it"),
				{
					seq: 1,
					role: "assistant",
					runId: "r1",
					content: {
						role: "assistant",
						content: [{ type: "tool-call", toolCallId: "t1", toolName: "save_route", input: {} }],
					},
				},
			],
			"executing",
		),
	);
	const { result } = setup();
	const es = await stream();
	const call = () => result.current.messages[1].parts[0];
	expect(call()).toMatchObject({ name: "save_route" });
	expect(call()).not.toHaveProperty("status");
	act(() =>
		es.emit({
			type: "tool-end",
			seq: 2,
			toolCallId: "t1",
			toolName: "save_route",
			status: "rejected",
		}),
	);
	expect(call()).toMatchObject({ status: "rejected" });
});

test("done reloads the saved rows and drops the live copy by seq", async () => {
	get.mockResolvedValue(detail([user(0, "build it")], "executing"));
	const { result } = setup();
	const es = await stream();
	act(() => es.emit({ type: "text", seq: 1, text: "Hello" }));
	get.mockResolvedValue(
		detail([user(0, "build it"), assistant(1, [{ type: "text", text: "Hello" }])], "completed"),
	);
	act(() => es.emit({ type: "done", seq: 1, status: "completed" }));
	await waitFor(() => expect(result.current.running).toBe(false));
	expect(es.closed).toBe(true);
	expect(texts(result.current.messages)).toEqual(["build it", "Hello"]);
	expect(FakeEventSource.all.length).toBe(1);
});

test("a dropped stream reloads and reopens from the new highest seq without doubling text", async () => {
	get.mockResolvedValue(detail([user(0, "build it")], "executing"));
	const { result } = setup();
	const first = await stream();
	act(() => first.emit({ type: "text", seq: 1, text: "Hel" }));
	const call = [{ type: "tool-call", toolCallId: "t1", toolName: "get_route", input: {} }];
	get.mockResolvedValue(
		detail([user(0, "build it"), assistant(1, call), toolRow(2, "t1", { ok: 1 })], "executing"),
	);
	act(() => first.onerror?.());
	const second = await stream(2);
	expect(first.closed).toBe(true);
	expect(second.url).toEndWith("afterSeq=2");
	act(() => second.emit({ type: "text", seq: 3, text: "done" }));
	expect(texts(result.current.messages)).toEqual(["build it", "done"]);
	expect(result.current.messages[1].parts[0]).toMatchObject({
		name: "get_route",
		output: { ok: 1 },
	});
});

test("a run that stopped at a limit reports why", async () => {
	get.mockResolvedValue(detail([user(0, "build it")], "executing"));
	const { result } = setup();
	const es = await stream();
	expect(result.current.stopReason).toBeNull();
	get.mockResolvedValue(detail([user(0, "build it")], "completed", "step_limit"));
	act(() => es.emit({ type: "done", seq: 0, status: "completed", reason: "step_limit" }));
	await waitFor(() => expect(result.current.stopReason).toBe("step_limit"));
});

test("a settled run opens no stream and shows its saved stop reason", async () => {
	get.mockResolvedValue(detail([user(0, "build it")], "completed", "token_budget"));
	const { result } = setup();
	await waitFor(() => expect(result.current.stopReason).toBe("token_budget"));
	expect(FakeEventSource.all.length).toBe(0);
	expect(result.current.running).toBe(false);
});

test("send shows the message at once and follows the new run", async () => {
	get.mockResolvedValue(
		detail([user(0, "hi"), assistant(1, [{ type: "text", text: "hello" }])], "completed"),
	);
	const send = spyOn(agentConversationsService, "send").mockResolvedValue({ runId: "r2" });
	const { result } = setup();
	await waitFor(() => expect(result.current.messages.length).toBe(2));
	await act(() => result.current.send("next"));
	expect(send).toHaveBeenCalledWith("p1", "c1", "next", "manual", "none");
	expect(texts(result.current.messages)).toEqual(["hi", "hello", "next"]);
	expect(result.current.running).toBe(true);
	expect((await stream()).url).toEndWith("/runs/r2/stream?afterSeq=1");
	send.mockRestore();
});

test("the thinking timer starts at the run's start, and a refresh or new tokens do not reset it", async () => {
	const d = detail([user(0, "build it")], "executing");
	(d.run as { createdAt?: string }).createdAt = "2026-10-09T10:00:00.000Z";
	get.mockResolvedValue(d);
	const { result } = setup();
	const es = await stream();
	expect(result.current.thinkingSince).toBe(Date.parse("2026-10-09T10:00:00.000Z"));
	act(() => es.emit({ type: "reasoning", seq: 1, text: "hmm" }));
	expect(result.current.thinkingSince).toBe(Date.parse("2026-10-09T10:00:00.000Z"));
});

test("after a refresh the timer starts at the last saved row, where the current call began", async () => {
	const d = detail([user(0, "build it"), toolRow(2, "t", { ok: true })], "executing");
	(d.run as { createdAt?: string }).createdAt = "2026-10-09T10:00:00.000Z";
	d.messages[1].createdAt = "2026-10-09T10:04:30.000Z";
	get.mockResolvedValue(d);
	const { result } = setup();
	await stream();
	expect(result.current.thinkingSince).toBe(Date.parse("2026-10-09T10:04:30.000Z"));
});

test("two thinks make two timers: the second starts when the tool result came in", async () => {
	const d = detail([user(0, "build it")], "executing");
	(d.run as { createdAt?: string }).createdAt = "2026-10-09T10:00:00.000Z";
	get.mockResolvedValue(d);
	const { result } = setup();
	const es = await stream();
	act(() => es.emit({ type: "reasoning", seq: 1, text: "first" }));
	act(() =>
		es.emit({
			type: "tool-start",
			seq: 1,
			toolCallId: "t",
			toolName: "get_route",
			toolTitle: "Get route",
			input: {},
		}),
	);
	const before = Date.now();
	act(() =>
		es.emit({ type: "tool-end", seq: 2, toolCallId: "t", toolName: "get_route", status: "done" }),
	);
	act(() => es.emit({ type: "reasoning", seq: 3, text: "second" }));
	// the run began long ago; the second call began just now
	expect(result.current.thinkingSince).toBeGreaterThanOrEqual(before);
	expect(Date.now() - result.current.thinkingSince).toBeLessThan(1000);
	const thoughts = result.current.messages.flatMap((m) =>
		m.parts.filter((p) => p.type === "reasoning"),
	) as { text: string; ms?: number }[];
	expect(thoughts.map((t) => t.text)).toEqual(["first", "second"]);
	expect(thoughts[0].ms).toBeDefined();
	expect(thoughts[1].ms).toBeUndefined();
});

const summaryRow = (seq: number, withStats = true): Row => ({
	seq,
	role: "summary",
	runId: "r1",
	content: {
		role: "user",
		content: "Summary of the earlier conversation:\nbuilt the users route",
		...(withStats && {
			compaction: {
				type: "compaction",
				kind: "summary",
				messages: 12,
				coversUpTo: 12,
				before: 102000,
				after: 9000,
			},
		}),
	},
});
const lines = (m: { role: string }[]) => m.filter((x) => x.role === "compaction");

test("a compaction event is a line in the chat; after the reload the saved summary row is the same line", async () => {
	get.mockResolvedValue(detail([user(0, "build it")], "executing"));
	const { result } = setup();
	const es = await stream();
	act(() =>
		es.emit({
			type: "compaction",
			seq: 1,
			compaction: {
				type: "compaction",
				kind: "summary",
				messages: 12,
				coversUpTo: 12,
				before: 102000,
				after: 9000,
			},
		}),
	);
	expect(lines(result.current.messages)).toHaveLength(1);
	expect(result.current.messages.at(-1)).toMatchObject({
		role: "compaction",
		compaction: { before: 102000 },
	});
	get.mockResolvedValue(detail([user(0, "build it"), summaryRow(1)], "completed"));
	act(() => es.emit({ type: "done", seq: 1, status: "completed" }));
	await waitFor(() => expect(result.current.running).toBe(false));
	const [line] = lines(result.current.messages) as {
		compaction?: { after: number };
		summary?: string;
	}[];
	expect(lines(result.current.messages)).toHaveLength(1);
	expect(line.compaction?.after).toBe(9000);
	expect(line.summary).toContain("built the users route");
});

test("compacting is on from the compacting event until it ends or the run is done", async () => {
	get.mockResolvedValue(detail([user(0, "build it")], "executing"));
	const { result } = setup();
	const es = await stream();
	expect(result.current.compacting).toBe(false);
	act(() => es.emit({ type: "compacting", seq: 1, on: true }));
	expect(result.current.compacting).toBe(true);
	act(() => es.emit({ type: "compacting", seq: 1, on: false }));
	expect(result.current.compacting).toBe(false);
	act(() => es.emit({ type: "compacting", seq: 1, on: true }));
	get.mockResolvedValue(detail([user(0, "build it")], "completed"));
	act(() => es.emit({ type: "done", seq: 1, status: "completed" }));
	await waitFor(() => expect(result.current.running).toBe(false));
	expect(result.current.compacting).toBe(false);
});

test("saved summary rows are lines after a refresh, in the latest page and in older pages", async () => {
	get.mockResolvedValue(detail([summaryRow(5), user(6, "next")], "completed", null, 5));
	const older = spyOn(agentConversationsService, "getOlder").mockResolvedValue({
		messages: [user(0, "a"), summaryRow(3, false), user(4, "b")],
		nextBeforeSeq: null,
	});
	const { result } = setup();
	await waitFor(() => expect(lines(result.current.messages)).toHaveLength(1));
	await act(() => result.current.loadOlder());
	expect(result.current.messages.map((m) => [m.role, m.seq])).toEqual([
		["user", 0],
		["compaction", 3],
		["user", 4],
		["compaction", 5],
		["user", 6],
	]);
	older.mockRestore();
});

test("/compact goes to the compact endpoint with its text, not as a message, and follows the job", async () => {
	get.mockResolvedValue(
		detail([user(0, "hi"), assistant(1, [{ type: "text", text: "hello" }])], "completed"),
	);
	const compact = spyOn(agentConversationsService, "compact").mockResolvedValue({ runId: "r2" });
	const send = spyOn(agentConversationsService, "send");
	const { result } = setup();
	await waitFor(() => expect(result.current.messages.length).toBe(2));
	await act(() => result.current.submit("/compact keep the route ids"));
	expect(compact).toHaveBeenCalledWith("p1", "c1", "keep the route ids");
	expect(send).not.toHaveBeenCalled();
	expect((await stream()).url).toEndWith("/runs/r2/stream?afterSeq=1");
	expect(result.current.running).toBe(true);
	expect(result.current.compacting).toBe(true);
	compact.mockRestore();
	send.mockRestore();
});

test("/compact alone sends no text; nothing to compact is a notice, not a run", async () => {
	get.mockResolvedValue(detail([user(0, "hi")], "completed"));
	const compact = spyOn(agentConversationsService, "compact").mockResolvedValue({
		runId: null,
		message: "Nothing to compact yet",
	});
	const { result } = setup();
	await waitFor(() => expect(result.current.messages.length).toBe(1));
	await act(() => result.current.submit("/compact"));
	expect(compact).toHaveBeenCalledWith("p1", "c1", undefined);
	expect(result.current.running).toBe(false);
	expect(FakeEventSource.all.length).toBe(0);
	compact.mockRestore();
});

test("/compact is refused while a run is active, and while an approval waits", async () => {
	const compact = spyOn(agentConversationsService, "compact");
	get.mockResolvedValue(detail([user(0, "build it")], "executing"));
	const { result } = setup();
	await stream();
	await expect(result.current.submit("/compact")).rejects.toThrow("Wait for the current run");
	cleanup();
	get.mockResolvedValue(detail([user(0, "build it")], "waiting_approval"));
	const second = setup();
	await waitFor(() => expect(second.result.current.waiting).toBe(true));
	await expect(second.result.current.submit("/compact")).rejects.toThrow(
		"Wait for the current run",
	);
	expect(compact).not.toHaveBeenCalled();
	compact.mockRestore();
});

test("an unknown slash text is an ordinary message", async () => {
	get.mockResolvedValue(detail([user(0, "hi")], "completed"));
	const send = spyOn(agentConversationsService, "send").mockResolvedValue({ runId: "r2" });
	const { result } = setup();
	await waitFor(() => expect(result.current.messages.length).toBe(1));
	await act(() => result.current.submit("/health should return 200"));
	expect(send).toHaveBeenCalledWith("p1", "c1", "/health should return 200", "manual", "none");
	send.mockRestore();
});

test("loadOlder prepends the page before the oldest row and stops when there is none", async () => {
	get.mockResolvedValue(detail([user(2, "c"), user(3, "d")], "completed", null, 2));
	const older = spyOn(agentConversationsService, "getOlder").mockResolvedValue({
		messages: [user(0, "a"), user(1, "b")],
		nextBeforeSeq: null,
	});
	const { result } = setup();
	await waitFor(() => expect(result.current.hasOlder).toBe(true));
	await act(() => result.current.loadOlder());
	expect(older).toHaveBeenCalledWith("p1", "c1", 2);
	expect(texts(result.current.messages)).toEqual(["a", "b", "c", "d"]);
	expect(result.current.hasOlder).toBe(false);
	older.mockRestore();
});

test("older pages stay and live messages are not dropped when the run ends and the latest page reloads", async () => {
	get.mockResolvedValue(detail([user(2, "c")], "executing", null, 2));
	const older = spyOn(agentConversationsService, "getOlder").mockResolvedValue({
		messages: [user(0, "a"), user(1, "b")],
		nextBeforeSeq: null,
	});
	const { result } = setup();
	const es = await stream();
	// The stream follows from the latest page's top, not from the older ones.
	expect(es.url).toEndWith("afterSeq=2");
	await act(() => result.current.loadOlder());
	act(() => es.emit({ type: "text", seq: 3, text: "Hello" }));
	expect(texts(result.current.messages)).toEqual(["a", "b", "c", "Hello"]);
	get.mockResolvedValue(
		detail([user(2, "c"), assistant(3, [{ type: "text", text: "Hello" }])], "completed", null, 2),
	);
	act(() => es.emit({ type: "done", seq: 3, status: "completed" }));
	await waitFor(() => expect(result.current.running).toBe(false));
	expect(texts(result.current.messages)).toEqual(["a", "b", "c", "Hello"]);
	expect(result.current.hasOlder).toBe(false);
	older.mockRestore();
});

test("older pages are dropped when a reload no longer joins them", async () => {
	get.mockResolvedValue(detail([user(2, "c")], "completed", null, 2));
	const older = spyOn(agentConversationsService, "getOlder").mockResolvedValue({
		messages: [user(0, "a"), user(1, "b")],
		nextBeforeSeq: null,
	});
	const { result } = setup();
	await waitFor(() => expect(result.current.hasOlder).toBe(true));
	await act(() => result.current.loadOlder());
	// A long run: the latest page now starts at 9, with 3..8 in between.
	get.mockResolvedValue(detail([user(9, "j")], "completed", null, 9));
	const stop = spyOn(agentConversationsService, "stop").mockResolvedValue(undefined as never);
	await act(() => result.current.stop());
	await waitFor(() => expect(texts(result.current.messages)).toEqual(["j"]));
	expect(result.current.hasOlder).toBe(true);
	older.mockRestore();
	stop.mockRestore();
});
