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

type Row = { seq: number; role: string; runId: string; content: unknown };
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
const detail = (messages: Row[], status: string, stopReason: string | null = null) => ({
	conversation: { id: "c1", title: "t", archived: false } as never,
	messages,
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
			input: { id: 1 },
		});
		es.emit({ type: "tool-end", seq: 2, toolCallId: "t1", toolName: "get_route", output: "ok" });
	});
	expect(result.current.running).toBe(true);
	const live = result.current.messages[1];
	expect(live.parts.map((p) => p.type)).toEqual(["reasoning", "text", "tool"]);
	expect(live.parts[1]).toEqual({ type: "text", text: "Hello" });
	expect(live.parts[2]).toMatchObject({ name: "get_route", output: "ok" });
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
