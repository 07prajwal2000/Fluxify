import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
Element.prototype.scrollIntoView = () => {};

mock.module("@tanstack/react-router", () => ({
	useParams: () => ({ projectId: "p1", conversationId: "c1" }),
	Link: ({ to, children, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));
// The Lexical editor is not what is tested here: a textarea with the same props stands in.
// Module mocks outlive the file, so the real editor is kept to put back when it is done.
const realEditor = { ...(await import("./PromptEditor")) };
mock.module("./PromptEditor", () => ({
	PromptEditor: ({ placeholder, onSubmit, controls, isRunning }: any) => {
		const { useState } = require("react");
		const [text, setText] = useState("");
		return (
			<div>
				{controls}
				<textarea
					aria-label="prompt"
					placeholder={placeholder}
					value={text}
					onChange={(e: any) => setText(e.target.value)}
				/>
				<button type="button" disabled={isRunning} onClick={() => onSubmit(text)}>
					Send
				</button>
			</div>
		);
	},
}));

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
/** Not RTL's waitFor/screen: they stay bound to the DOM of whichever test file loaded RTL first. */
const q = () => within(document.body);
async function until<T>(check: () => T, timeout = 1500): Promise<T> {
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
const { ConversationPage } = await import("./ConversationPage");

type Row = { seq: number; role: string; runId: string; content: unknown; createdAt?: string };
const user = (seq: number, text: string): Row => ({
	seq,
	role: "user",
	runId: "r1",
	content: { role: "user", content: text },
});
const call = (seq: number, name: string, input: unknown, text = ""): Row => ({
	seq,
	role: "assistant",
	runId: "r1",
	content: {
		role: "assistant",
		content: [
			...(text ? [{ type: "text", text }] : []),
			{ type: "tool-call", toolCallId: `t${seq}`, toolName: name, input },
		],
	},
});
const reply = (seq: number, text: string): Row => ({
	seq,
	role: "assistant",
	runId: "r1",
	content: { role: "assistant", content: [{ type: "text", text }] },
});

type Settings = { mode: string; effort: string; supportsThinking: boolean };
const detail = (messages: Row[], status: string, settings: Partial<Settings> = {}) => ({
	conversation: { id: "c1", title: "t", archived: false },
	messages,
	nextBeforeSeq: null as number | null,
	run: { id: "r1", status, stopReason: null, usage: null },
	settings: { mode: "manual", effort: "none", supportsThinking: true, ...settings },
});

/** Callbacks of the observers a render armed; the last one is the top sentinel. */
let observers: ((e: { isIntersecting: boolean }[]) => void)[] = [];
const saved: { es?: typeof EventSource; io?: typeof IntersectionObserver } = {};
let get: ReturnType<typeof spyOn>;
let approve: ReturnType<typeof spyOn>;
let send: ReturnType<typeof spyOn>;
beforeEach(() => {
	// per test: the other DOM test files set these once, at load
	saved.es = globalThis.EventSource;
	saved.io = globalThis.IntersectionObserver;
	globalThis.EventSource = class {
		addEventListener() {}
		close() {}
	} as never;
	observers = [];
	globalThis.IntersectionObserver = class {
		constructor(public cb: (e: { isIntersecting: boolean }[]) => void) {}
		observe() {
			observers.push(this.cb);
		}
		disconnect() {}
	} as never;
	get = spyOn(agentConversationsService, "get");
	approve = spyOn(agentConversationsService, "approve").mockResolvedValue({ runId: "r1" });
	send = spyOn(agentConversationsService, "send").mockResolvedValue({ runId: "r2" });
});
afterEach(() => {
	cleanup();
	globalThis.EventSource = saved.es as never;
	globalThis.IntersectionObserver = saved.io as never;
	for (const s of [get, approve, send]) s.mockRestore();
});
afterAll(() => {
	mock.module("./PromptEditor", () => realEditor);
	GlobalRegistrator.unregister();
});

function open(d: ReturnType<typeof detail>) {
	get.mockResolvedValue(d as never);
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ConversationPage />
		</QueryClientProvider>,
	);
}
const waiting = (
	name = "save_route",
	input: unknown = { name: "users", path: "/users", method: "GET" },
) => detail([user(0, "build it"), call(1, name, input)], "waiting_approval");
const bar = () => until(() => q().getByRole("region", { name: "Approval needed" }));
const prompt = () => q().getByLabelText("prompt") as HTMLTextAreaElement;

test("a waiting change shows the tool and its input above the editor, with the new placeholder", async () => {
	open(waiting());
	const region = await bar();
	expect(region.textContent).toContain("Save route");
	expect(region.textContent).toContain("GET /users");
	expect(region.textContent).not.toContain("Deletes");
	expect(prompt().placeholder).toBe("Type a follow-up or change the plan…");
	// the old row text is gone
	expect(document.body.textContent).not.toContain("Waiting for approval");
});

test("Approve and its Auto menu are one button group; Reject stays outside it", async () => {
	open(waiting());
	const region = await bar();
	const group = q().getByRole("button", { name: "Approve" }).closest("[role=group]") as HTMLElement;
	expect(group).not.toBeNull();
	expect(group.contains(q().getByRole("button", { name: "More approve options" }))).toBe(true);
	expect(group.contains(q().getByRole("button", { name: "Reject" }))).toBe(false);
	expect(region.contains(group)).toBe(true);
});

test("a delete is marked as one", async () => {
	open(waiting("delete_route", { routeId: "abcdef" }));
	expect((await bar()).textContent).toContain("Deletes");
});

test("Approve approves and puts the conversation in manual", async () => {
	open(waiting());
	await bar();
	fireEvent.click(q().getByRole("button", { name: "Approve" }));
	await until(() => expect(approve).toHaveBeenCalled());
	expect(approve).toHaveBeenCalledWith("p1", "c1", {
		approve: true,
		mode: "manual",
		effort: "none",
	});
});

test("Approve with Auto approves and puts the conversation in auto", async () => {
	open(waiting());
	await bar();
	fireEvent.click(q().getByRole("button", { name: "More approve options" }));
	fireEvent.click(await until(() => q().getByRole("menuitem", { name: "Approve with Auto" })));
	await until(() => expect(approve).toHaveBeenCalled());
	expect(approve).toHaveBeenCalledWith("p1", "c1", { approve: true, mode: "auto", effort: "none" });
});

test("Reject rejects with no reason", async () => {
	open(waiting());
	await bar();
	fireEvent.click(q().getByRole("button", { name: "Reject" }));
	await until(() => expect(approve).toHaveBeenCalled());
	expect(approve).toHaveBeenCalledWith("p1", "c1", {
		approve: false,
		mode: "manual",
		effort: "none",
	});
	expect(send).not.toHaveBeenCalled();
});

test("typing while it waits rejects with the text as the reason", async () => {
	open(waiting());
	await bar();
	fireEvent.change(prompt(), { target: { value: "use /v2 instead" } });
	fireEvent.click(q().getByRole("button", { name: "Send" }));
	await until(() => expect(approve).toHaveBeenCalled());
	expect(approve).toHaveBeenCalledWith("p1", "c1", {
		approve: false,
		reason: "use /v2 instead",
		mode: "manual",
		effort: "none",
	});
	expect(send).not.toHaveBeenCalled();
});

test("a plan in plan mode gets the same bar; Approve starts it in manual, Auto in auto", async () => {
	open(
		detail([user(0, "add /health"), reply(1, "1. add the route\n2. test it")], "completed", {
			mode: "plan",
		}),
	);
	const region = await bar();
	expect(region.textContent).toContain("Plan ready");
	expect(prompt().placeholder).toBe("Type a follow-up or change the plan…");
	fireEvent.click(q().getByRole("button", { name: "More approve options" }));
	fireEvent.click(await until(() => q().getByRole("menuitem", { name: "Approve with Auto" })));
	await until(() => expect(send).toHaveBeenCalled());
	expect(send).toHaveBeenCalledWith("p1", "c1", "Go ahead with the plan.", "auto", "none");
	expect(approve).not.toHaveBeenCalled();
});

test("rejecting a plan only dismisses it; typing changes sends them in plan mode", async () => {
	open(
		detail([user(0, "add /health"), reply(1, "1. add the route")], "completed", { mode: "plan" }),
	);
	await bar();
	fireEvent.click(q().getByRole("button", { name: "Reject" }));
	await until(() => expect(q().queryByRole("region", { name: "Approval needed" })).toBeNull());
	expect(send).not.toHaveBeenCalled();
	expect(approve).not.toHaveBeenCalled();
	fireEvent.change(prompt(), { target: { value: "also add auth" } });
	fireEvent.click(q().getByRole("button", { name: "Send" }));
	await until(() => expect(send).toHaveBeenCalledWith("p1", "c1", "also add auth", "plan", "none"));
});

test("no bar and the plain placeholder when nothing waits", async () => {
	open(detail([user(0, "hi"), reply(1, "hello")], "completed"));
	await until(() => expect(prompt().placeholder).toBe("Reply to AI..."));
	expect(q().queryByRole("region", { name: "Approval needed" })).toBeNull();
});

test("the pickers start from what the conversation saved and a message goes out with them", async () => {
	open(detail([user(0, "hi"), reply(1, "hello")], "completed", { mode: "plan", effort: "high" }));
	await until(() => expect(q().getByLabelText("Mode").textContent).toContain("Plan"));
	expect(q().getByLabelText("Thinking effort").textContent).toContain("High");
	fireEvent.change(prompt(), { target: { value: "more" } });
	fireEvent.click(q().getByRole("button", { name: "Send" }));
	await until(() => expect(send).toHaveBeenCalled());
	expect(send).toHaveBeenCalledWith("p1", "c1", "more", "plan", "high");
});

test("effort is disabled with a reason when the model does not think", async () => {
	open(
		detail([user(0, "hi"), reply(1, "hello")], "completed", {
			supportsThinking: false,
			effort: "high",
		}),
	);
	await until(() => expect(q().getByLabelText("Thinking effort")).toBeTruthy());
	const effort = q().getByLabelText("Thinking effort");
	expect(effort.closest("[title]")?.getAttribute("title")).toBe(
		"This model doesn't support thinking",
	);
	expect(effort.textContent).toContain("No thinking");
	expect(effort.getAttribute("aria-disabled") ?? effort.hasAttribute("disabled")).toBeTruthy();
	// the mode picker is not affected
	expect(q().getByLabelText("Mode").closest("[title]")).toBeNull();
});

test("an approval that picks Auto leaves the mode picker on Auto", async () => {
	open(waiting());
	await bar();
	expect(q().getByLabelText("Mode").textContent).toContain("Manual");
	fireEvent.click(q().getByRole("button", { name: "More approve options" }));
	fireEvent.click(await until(() => q().getByRole("menuitem", { name: "Approve with Auto" })));
	await until(() => expect(q().getByLabelText("Mode").textContent).toContain("Auto"));
});

test("a first message from the new-chat page goes out with the mode and effort picked there", async () => {
	const { queueMessage } = await import("./useAgentConversation");
	queueMessage("c1", "build it", { mode: "plan", effort: "low" });
	open(detail([], "completed"));
	await until(() => expect(send).toHaveBeenCalledWith("p1", "c1", "build it", "plan", "low"));
});

const result = (seq: number, id: string, output: unknown): Row => ({
	seq,
	role: "tool",
	runId: "r1",
	content: {
		role: "tool",
		content: [{ type: "tool-result", toolCallId: id, toolName: "x", output }],
	},
});
const finished = (output: unknown) =>
	detail(
		[user(0, "go"), call(1, "call_route", { routeId: "r" }), result(2, "t1", output)],
		"completed",
	);

test("tool rows show the title; a rejected, failed or 4xx call has its own icon, never a spinner", async () => {
	open(finished({ type: "execution-denied", reason: "no" }));
	await until(() => q().getByLabelText("Rejected"));
	expect(document.body.textContent).toContain("Call route");
	expect(document.body.textContent).not.toContain("call_route");
	cleanup();
	open(finished({ type: "error-text", value: "boom" }));
	await until(() => q().getByLabelText("Failed"));
	cleanup();
	open(finished({ type: "json", value: { status: 500, body: "x" } }));
	await until(() => q().getByLabelText("Failed"));
	cleanup();
	open(finished({ type: "json", value: { status: 200 } }));
	await until(() => q().getByLabelText("Done"));
});

test("Reject marks the waiting row rejected at once, before the run answers", async () => {
	approve.mockReturnValue(new Promise(() => {}));
	open(waiting());
	await bar();
	expect(q().queryByLabelText("Rejected")).toBeNull();
	fireEvent.click(q().getByRole("button", { name: "Reject" }));
	await until(() => q().getByLabelText("Rejected"));
});

test("an open thinking block has a Collapse at the bottom that closes it", async () => {
	open(
		detail(
			[
				user(0, "hi"),
				{
					seq: 1,
					role: "assistant",
					runId: "r1",
					content: { role: "assistant", content: [{ type: "reasoning", text: "long thought" }] },
				},
			],
			"completed",
		),
	);
	const thought = (await until(() => q().getByText("Thought"))).closest(
		"details",
	) as HTMLDetailsElement;
	fireEvent.click(q().getByText("Thought"));
	await until(() => expect(thought.open).toBe(true));
	fireEvent.click(q().getByRole("button", { name: "Collapse" }));
	await until(() => expect(thought.open).toBe(false));
});

const summaryRow = (seq: number): Row => ({
	seq,
	role: "summary",
	runId: "r1",
	content: {
		role: "user",
		content: "Summary of the earlier conversation:\nbuilt the users route",
		compaction: {
			type: "compaction",
			kind: "summary",
			messages: 12,
			coversUpTo: 12,
			before: 102000,
			after: 9000,
		},
	},
});

test("a saved summary row is a quiet line where it happened; it opens to read the summary", async () => {
	open(detail([user(0, "build it"), summaryRow(1), user(2, "go on")], "completed"));
	const line = await until(() => q().getByText("Context compacted: 102k → 9k tokens"));
	const details = line.closest("details") as HTMLDetailsElement;
	expect(details.open).toBe(false);
	expect(details.textContent).toContain("built the users route");
	// between the two user messages
	const text = document.body.textContent ?? "";
	expect(text.indexOf("build it")).toBeLessThan(text.indexOf("Context compacted"));
	expect(text.indexOf("Context compacted")).toBeLessThan(text.indexOf("go on"));
	fireEvent.click(line);
	await until(() => expect(details.open).toBe(true));
});

test("a running /compact says so instead of Thinking…", async () => {
	const d = detail([user(0, "hi"), reply(1, "hello")], "executing");
	(d.run as { userQuery?: string }).userQuery = "/compact keep the ids";
	open(d);
	await until(() => q().getByText("Compacting the conversation…"));
	expect(q().queryByText(/Thinking…/)).toBeNull();
});

test("scrolling to the top loads the older page, shows a loader, and keeps the scroll position", async () => {
	let height = 1000;
	Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
		configurable: true,
		get: () => height,
	});
	let release!: (v: { messages: Row[]; nextBeforeSeq: number | null }) => void;
	const older = spyOn(agentConversationsService, "getOlder").mockReturnValue(
		new Promise((r) => {
			release = r;
		}),
	);
	try {
		open({
			...detail([user(2, "latest question"), reply(3, "latest answer")], "completed"),
			nextBeforeSeq: 2,
		});
		await until(() => q().getByText("latest answer"));
		const scroller = document.querySelector(".overflow-y-auto") as HTMLElement;
		scroller.scrollTop = 0;
		act(() => observers.at(-1)?.([{ isIntersecting: true }]));
		await until(() => q().getByRole("status", { name: "Loading older messages" }));
		expect(older).toHaveBeenCalledWith("p1", "c1", 2);
		height = 1600; // the older rows add 600px above
		await act(async () =>
			release({ messages: [user(0, "old question"), reply(1, "old answer")], nextBeforeSeq: null }),
		);
		await until(() => q().getByText("old answer"));
		expect(q().queryByRole("status", { name: "Loading older messages" })).toBeNull();
		expect(scroller.scrollTop).toBe(600);
	} finally {
		// biome-ignore lint/performance/noDelete: restore the prototype
		delete (HTMLElement.prototype as any).scrollHeight;
		older.mockRestore();
	}
});
