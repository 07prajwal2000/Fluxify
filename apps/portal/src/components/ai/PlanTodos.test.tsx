import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ToolPart } from "./agentMessages";

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
// The Lexical editor is not what is tested here: its controls are. Module mocks outlive the file,
// so the real editor is kept to put back when it is done.
const realEditor = { ...(await import("./PromptEditor")) };
mock.module("./PromptEditor", () => ({
	PromptEditor: ({ controls }: any) => <div>{controls}</div>,
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
const { ToolRow } = await import("./ToolRow");
const { toolSummary } = await import("./preview/toolHeader");

type Row = { seq: number; role: string; runId: string; content: unknown };
const user: Row = {
	seq: 0,
	role: "user",
	runId: "r1",
	content: { role: "user", content: "build a shop" },
};
const suggest: Row = {
	seq: 1,
	role: "assistant",
	runId: "r1",
	content: {
		role: "assistant",
		content: [
			{
				type: "tool-call",
				toolCallId: "s1",
				toolName: "suggest_plan_mode",
				input: { reason: "Three routes and a workflow" },
			},
		],
	},
};
const todos = [
	{
		id: "1",
		text: "Build the routes",
		status: "in_progress",
		subtasks: [
			{ id: "1.1", text: "GET /products", status: "done" },
			{ id: "1.2", text: "POST /orders", status: "in_progress" },
		],
	},
	{ id: "2", text: "Write tests", status: "pending" },
	{ id: "3", text: "Old idea", status: "dropped" },
];
const detail = (rows: Row[], status: string, mode: string, saved?: unknown[]) => ({
	conversation: { id: "c1", title: "t", archived: false },
	messages: [user, ...rows],
	nextBeforeSeq: null as number | null,
	run: { id: "r1", status, stopReason: null, usage: null },
	settings: { mode, effort: "none", supportsThinking: false },
	...(saved && { todos: saved }),
});

/** The stream the page opens; `emit` sends it an event. */
let stream: { emit: (type: string, data: object) => void } | undefined;
let get: ReturnType<typeof spyOn>;
let approve: ReturnType<typeof spyOn>;
let savedIo: typeof IntersectionObserver;
let savedEs: typeof EventSource;
beforeEach(() => {
	savedIo = globalThis.IntersectionObserver;
	globalThis.IntersectionObserver = class {
		observe() {}
		disconnect() {}
	} as never;
	savedEs = globalThis.EventSource;
	globalThis.EventSource = class {
		listeners = new Map<string, (m: { data: string }) => void>();
		constructor() {
			stream = {
				emit: (type, data) =>
					act(() => this.listeners.get(type)?.({ data: JSON.stringify({ type, ...data }) })),
			};
		}
		addEventListener(type: string, f: (m: { data: string }) => void) {
			this.listeners.set(type, f);
		}
		close() {}
	} as never;
	get = spyOn(agentConversationsService, "get");
	approve = spyOn(agentConversationsService, "approve").mockResolvedValue({ runId: "r1" });
});
afterEach(() => {
	cleanup();
	stream = undefined;
	globalThis.IntersectionObserver = savedIo as never;
	globalThis.EventSource = savedEs as never;
	for (const s of [get, approve]) s.mockRestore();
});
afterAll(() => {
	mock.module("./PromptEditor", () => realEditor);
	GlobalRegistrator.unregister();
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
function open(d: ReturnType<typeof detail>) {
	get.mockResolvedValue(d as never);
	render(
		<QueryClientProvider client={client()}>
			<ConversationPage />
		</QueryClientProvider>,
	);
}
const bar = () => until(() => q().getByRole("region", { name: "Approval needed" }));
const pickerMode = () => q().getByLabelText("Mode").textContent ?? "";

test("the suggestion card shows the reason and never offers Approve or Reject", async () => {
	open(detail([suggest], "waiting_approval", "manual"));
	const card = within(await bar());
	expect(card.getByText("Three routes and a workflow")).toBeTruthy();
	expect(card.queryByRole("button", { name: "Approve" })).toBeNull();
	expect(card.queryByRole("button", { name: "Reject" })).toBeNull();
	expect(card.queryByRole("button", { name: "More approve options" })).toBeNull();
});

test("Switch to plan approves with mode plan and the picker shows Plan", async () => {
	open(detail([suggest], "waiting_approval", "manual"));
	fireEvent.click(within(await bar()).getByRole("button", { name: "Switch to plan" }));
	await until(() => expect(approve).toHaveBeenCalled());
	expect(approve).toHaveBeenCalledWith("p1", "c1", { approve: true, mode: "plan", effort: "none" });
	await until(() => expect(pickerMode()).toContain("Plan"));
});

test("Continue anyway approves in the conversation's mode", async () => {
	open(detail([suggest], "waiting_approval", "auto"));
	fireEvent.click(within(await bar()).getByRole("button", { name: "Continue anyway" }));
	await until(() => expect(approve).toHaveBeenCalled());
	// no mode: the server keeps the conversation's
	expect(approve).toHaveBeenCalledWith("p1", "c1", { approve: true, effort: "none" });
	expect(pickerMode()).toContain("Auto");
});

test("no tasks button without a list", async () => {
	open(detail([], "completed", "manual", []));
	await until(() => q().getByLabelText("Mode"));
	expect(q().queryByRole("button", { name: /^Tasks/ })).toBeNull();
});

test("the tasks button shows progress, lists every task, and follows a new update_todos", async () => {
	// the saved list comes from the server: its update_todos call is not on the loaded page
	open(detail([], "executing", "manual", todos));
	const button = await until(() => q().getByRole("button", { name: "Tasks: 0 of 2 done" }));
	expect(button.textContent).toContain("0/2");
	fireEvent.click(button);
	const list = within(await until(() => q().getByRole("list", { name: "Tasks" })));
	const status = (text: string) =>
		list.getByText(text).closest("[data-status]")?.getAttribute("data-status");
	expect(status("Build the routes")).toBe("in_progress");
	expect(status("GET /products")).toBe("done");
	expect(status("POST /orders")).toBe("in_progress");
	expect(status("Write tests")).toBe("pending");
	expect(status("Old idea")).toBe("dropped");

	// the agent marks 1.2 done: the live result carries the whole list
	const done = [
		{
			...todos[0],
			status: "done",
			subtasks: todos[0].subtasks?.map((s) => ({ ...s, status: "done" })),
		},
		todos[1],
		todos[2],
	];
	const input = { id: "1.2", status: "done" };
	await until(() => expect(stream).toBeDefined());
	stream?.emit("tool-start", { seq: 1, toolCallId: "u1", toolName: "update_todos", input });
	stream?.emit("tool-end", {
		seq: 2,
		toolCallId: "u1",
		toolName: "update_todos",
		status: "done",
		output: { todos: done, next: todos[1] },
	});
	await until(() => q().getByRole("button", { name: "Tasks: 1 of 2 done" }));
});

const tool = (over: Partial<ToolPart>): ToolPart => ({
	type: "tool",
	id: "t",
	name: "update_todos",
	input: {},
	...over,
});

test("tool summary lines say what changed", () => {
	const items = [{ text: "a" }, { text: "b", subtasks: [{ text: "b1" }] }];
	expect(toolSummary(tool({ input: { items } }))).toBe("Wrote 2 tasks");
	expect(toolSummary(tool({ input: { items: [{ text: "a" }] } }))).toBe("Wrote 1 task");
	expect(toolSummary(tool({ input: { items: [] } }))).toBe("Cleared the list");
	expect(toolSummary(tool({ input: { id: "1.2", status: "done" } }))).toBe("Marked 1.2 done");
	expect(toolSummary(tool({ input: { id: "2", status: "in_progress" } }))).toBe(
		"Marked 2 in progress",
	);
	expect(
		toolSummary(tool({ name: "suggest_plan_mode", input: { reason: "Needs several routes" } })),
	).toBe("Needs several routes");
});

const row = (t: ToolPart) =>
	render(
		<QueryClientProvider client={client()}>
			<ToolRow tool={t} waiting={false} running={false} />
		</QueryClientProvider>,
	);

test("the update_todos card previews the list and the next task, with Raw beside it", async () => {
	const input = { id: "1.1", status: "done" };
	row(tool({ input, status: "done", output: { todos, next: todos[0].subtasks?.[1] } }));
	expect(q().getByText("Marked 1.1 done")).toBeTruthy();
	fireEvent.click(q().getByText("Marked 1.1 done"));
	const list = await until(() => q().getByRole("list", { name: "Tasks" }));
	expect(within(list).getByText("Write tests")).toBeTruthy();
	expect(q().getByText(/Next:/).textContent).toContain("1.2 POST /orders");
	fireEvent.click(q().getByRole("tab", { name: "Raw" }));
	await until(() => expect(q().queryByRole("list", { name: "Tasks" })).toBeNull());
	expect(document.body.textContent).toContain('"status": "done"');
});

test("the suggest_plan_mode card shows the reason and the answer", async () => {
	const input = { reason: "Three routes and a workflow" };
	const out = "User switched to plan mode: look around with read tools and write the plan now.";
	row(tool({ name: "suggest_plan_mode", input, status: "done", output: out }));
	fireEvent.click(q().getAllByText("Three routes and a workflow")[0]);
	await until(() => q().getByText("Switched to plan mode"));
	cleanup();
	const other = "User chose to continue without a plan. Go on with the task.";
	row(tool({ name: "suggest_plan_mode", input, status: "done", output: other }));
	fireEvent.click(q().getAllByText("Three routes and a workflow")[0]);
	await until(() => q().getByText("Continued without a plan"));
	fireEvent.click(q().getByRole("tab", { name: "Raw" }));
	await until(() => expect(q().queryByText("Continued without a plan")).toBeNull());
});
