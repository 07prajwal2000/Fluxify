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

type Row = { seq: number; role: string; runId: string; content: unknown; createdAt?: string };
const asked: Row = {
	seq: 0,
	role: "user",
	runId: "r1",
	content: { role: "user", content: "build it" },
};
/** The row a tool result is saved on: where the model call after it began. */
const ran: Row = {
	seq: 2,
	role: "tool",
	runId: "r1",
	content: {
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId: "t",
				toolName: "get_route",
				output: { type: "json", value: {} },
			},
		],
	},
	createdAt: "2026-10-09T10:04:30.000Z",
};
/** The run row's createdAt is when it was queued: the wait starts there. */
const detail = (status: string, messages: Row[] = [asked]) => ({
	conversation: { id: "c1", title: "t", archived: false } as never,
	messages,
	nextBeforeSeq: null,
	run: { id: "r1", status, stopReason: null, createdAt: "2026-10-09T10:00:00.000Z" } as never,
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
const stream = async () => {
	await waitFor(() => expect(FakeEventSource.all.length).toBe(1));
	return FakeEventSource.all[0];
};

test("queued, waiting for the model and thinking are three phases, each timed from its own event", async () => {
	get.mockResolvedValue(detail("queued") as never);
	const { result } = setup();
	const es = await stream();
	// in the queue: no worker has picked the job up
	expect(result.current.phase).toBe("queued");
	expect(result.current.phaseSince).toBe(Date.parse("2026-10-09T10:00:00.000Z"));
	act(() => es.emit({ type: "call-start", seq: -1, at: Date.parse("2026-10-09T10:00:20.000Z") }));
	// picked up, the model call is out, nothing back yet
	expect(result.current.phase).toBe("waiting");
	expect(result.current.phaseSince).toBe(Date.parse("2026-10-09T10:00:20.000Z"));
	act(() =>
		es.emit({ type: "reasoning-start", seq: 1, at: Date.parse("2026-10-09T10:00:35.000Z") }),
	);
	// thinking, timed from the reasoning itself, not from the run's start
	expect(result.current.phase).toBe("thinking");
	expect(result.current.phaseSince).toBe(Date.parse("2026-10-09T10:00:35.000Z"));
});

test("a refresh rebuilds the phase from the run row and the events' own times", async () => {
	get.mockResolvedValue(detail("executing", [asked, ran]) as never);
	const { result } = setup();
	const es = await stream();
	// the run row says the job was picked up; the last saved row is where the call began
	expect(result.current.phase).toBe("waiting");
	expect(result.current.phaseSince).toBe(Date.parse("2026-10-09T10:04:30.000Z"));
	// the replayed events carry their own times, so the timer does not restart
	act(() => es.emit({ type: "call-start", seq: -1, at: Date.parse("2026-10-09T10:00:10.000Z") }));
	act(() =>
		es.emit({ type: "reasoning-start", seq: 3, at: Date.parse("2026-10-09T10:04:40.000Z") }),
	);
	expect(result.current.phase).toBe("thinking");
	expect(result.current.phaseSince).toBe(Date.parse("2026-10-09T10:04:40.000Z"));
});

test("two thinks make two timers: the second starts when the tool result came in", async () => {
	get.mockResolvedValue(detail("executing") as never);
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
	// that call is over: the run is back to waiting on the model
	expect(result.current.phase).toBe("waiting");
	act(() => es.emit({ type: "reasoning", seq: 3, text: "second" }));
	// the run began long ago; the second call began just now
	expect(result.current.phase).toBe("thinking");
	expect(result.current.phaseSince).toBeGreaterThanOrEqual(before);
	expect(Date.now() - result.current.phaseSince).toBeLessThan(1000);
	const thoughts = result.current.messages.flatMap((m) =>
		m.parts.filter((p) => p.type === "reasoning"),
	) as { text: string; ms?: number }[];
	expect(thoughts.map((t) => t.text)).toEqual(["first", "second"]);
	expect(thoughts[0].ms).toBeDefined();
	expect(thoughts[1].ms).toBeUndefined();
});
