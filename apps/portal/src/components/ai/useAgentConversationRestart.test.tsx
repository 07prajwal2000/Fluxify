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
	constructor(public url: string) {
		FakeEventSource.all.push(this);
	}
	addEventListener(type: string, f: (m: { data: string }) => void) {
		this.listeners[type] = [...(this.listeners[type] ?? []), f];
	}
	close() {}
	emit(e: AgentEvent) {
		for (const f of this.listeners[e.type] ?? []) f({ data: JSON.stringify(e) });
	}
}
globalThis.EventSource = FakeEventSource as never;

const { act, cleanup, renderHook } = await import("@testing-library/react");
/** Not RTL's waitFor: it stays bound to the DOM of whichever test file loaded RTL first. */
async function waitFor(check: () => void, timeout = 3000) {
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

const asked = {
	seq: 0,
	role: "user",
	runId: "r1",
	content: { role: "user", content: "build it" },
};
const detail = (status: string, stopReason: string | null = null) => ({
	conversation: { id: "c1", title: "t", archived: false } as never,
	messages: [asked],
	nextBeforeSeq: null,
	run: { id: "r1", status, stopReason } as never,
	settings: { mode: "manual", effort: "none", supportsThinking: false },
});
const half: AgentEvent = { type: "text", seq: 1, text: "Half an answ" };
const lost: AgentEvent = { type: "done", seq: -1, status: "interrupted", reason: "restarted" };
const texts = (m: { parts: { type: string; text?: string }[] }[]) =>
	m.flatMap((x) => x.parts.filter((p) => p.type === "text").map((p) => p.text));

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
const stream = async () => {
	await waitFor(() => expect(FakeEventSource.all.length).toBe(1));
	return FakeEventSource.all[0];
};

test("a run lost to a restart keeps the half-written answer above the notice", async () => {
	get.mockResolvedValue(detail("executing"));
	const { result } = setup();
	const es = await stream();
	act(() => es.emit(half));
	get.mockResolvedValue(detail("interrupted", "restarted"));
	act(() => es.emit(lost));
	await waitFor(() => expect(result.current.stopReason).toBe("restarted"));
	expect(texts(result.current.messages)).toEqual(["build it", "Half an answ"]);
	expect(result.current.running).toBe(false);
});

test("opening a conversation whose run was lost replays the half answer without calling it running", async () => {
	get.mockResolvedValue(detail("interrupted", "restarted"));
	const { result } = setup();
	const es = await stream();
	expect(es.url).toEndWith("/ai/v1/agent/runs/r1/stream?afterSeq=0");
	expect(result.current.running).toBe(false);
	act(() => {
		es.emit(half);
		es.emit(lost);
	});
	await waitFor(() => expect(texts(result.current.messages)).toEqual(["build it", "Half an answ"]));
	expect(result.current.running).toBe(false);
	expect(result.current.stopReason).toBe("restarted");
});

test("a message sent after the restart replaces the half answer", async () => {
	get.mockResolvedValue(detail("interrupted", "restarted"));
	const send = spyOn(agentConversationsService, "send").mockResolvedValue({ runId: "r2" });
	const { result } = setup();
	const es = await stream();
	act(() => {
		es.emit(half);
		es.emit(lost);
	});
	await waitFor(() => expect(texts(result.current.messages)).toContain("Half an answ"));
	await act(() => result.current.send("carry on"));
	expect(texts(result.current.messages)).not.toContain("Half an answ");
	send.mockRestore();
});
