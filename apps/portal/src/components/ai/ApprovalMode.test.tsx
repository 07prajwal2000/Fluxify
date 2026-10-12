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
	PromptEditor: ({ controls, onSubmit, isRunning }: any) => {
		const { useState } = require("react");
		const [text, setText] = useState("");
		return (
			<div>
				{controls}
				<textarea aria-label="prompt" value={text} onChange={(e: any) => setText(e.target.value)} />
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

type Row = { seq: number; role: string; runId: string; content: unknown };
const user: Row = {
	seq: 0,
	role: "user",
	runId: "r1",
	content: { role: "user", content: "build it" },
};
const call = (seq: number, ids: string[]): Row => ({
	seq,
	role: "assistant",
	runId: "r1",
	content: {
		role: "assistant",
		content: ids.map((id) => ({
			type: "tool-call",
			toolCallId: id,
			toolName: "save_route",
			input: { name: id },
		})),
	},
});
const reply = (seq: number, text: string): Row => ({
	seq,
	role: "assistant",
	runId: "r1",
	content: { role: "assistant", content: [{ type: "text", text }] },
});
const detail = (rows: Row[], status: string, mode: string) => ({
	conversation: { id: "c1", title: "t", archived: false },
	messages: [user, ...rows],
	nextBeforeSeq: null as number | null,
	run: { id: "r1", status, stopReason: null, usage: null },
	settings: { mode, effort: "none", supportsThinking: false },
});

let get: ReturnType<typeof spyOn>;
let approve: ReturnType<typeof spyOn>;
let send: ReturnType<typeof spyOn>;
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
		addEventListener() {}
		close() {}
	} as never;
	get = spyOn(agentConversationsService, "get");
	approve = spyOn(agentConversationsService, "approve").mockResolvedValue({ runId: "r1" });
	send = spyOn(agentConversationsService, "send").mockResolvedValue({ runId: "r2" });
});
afterEach(() => {
	cleanup();
	globalThis.IntersectionObserver = savedIo as never;
	globalThis.EventSource = savedEs as never;
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
const bar = () => until(() => q().getByRole("region", { name: "Approval needed" }));
const pickerMode = () => q().getByLabelText("Mode").textContent ?? "";

test("Approve on an auto conversation leaves the picker on Auto and sends no mode (#784)", async () => {
	open(detail([call(1, ["t1"])], "waiting_approval", "auto"));
	await bar();
	expect(pickerMode()).toContain("Auto");
	fireEvent.click(q().getByRole("button", { name: "Approve" }));
	await until(() => expect(approve).toHaveBeenCalled());
	// no mode: the server keeps the conversation's
	expect(approve).toHaveBeenCalledWith("p1", "c1", { approve: true, effort: "none" });
	expect(pickerMode()).toContain("Auto");
});

test("Reject on an auto conversation leaves the picker on Auto and sends no mode (#784)", async () => {
	open(detail([call(1, ["t1"])], "waiting_approval", "auto"));
	await bar();
	fireEvent.click(q().getByRole("button", { name: "Reject" }));
	await until(() => expect(approve).toHaveBeenCalled());
	expect(approve).toHaveBeenCalledWith("p1", "c1", { approve: false, effort: "none" });
	expect(pickerMode()).toContain("Auto");
	expect(send).not.toHaveBeenCalled();
});

test("Approve all with several calls sends no mode and keeps the conversation's (#784)", async () => {
	open(detail([call(1, ["a", "b"])], "waiting_approval", "auto"));
	await bar();
	fireEvent.click(q().getByRole("button", { name: "Approve all (2)" }));
	await until(() => expect(approve).toHaveBeenCalled());
	expect(approve).toHaveBeenCalledWith("p1", "c1", {
		decisions: [
			{ toolCallId: "a", approve: true },
			{ toolCallId: "b", approve: true },
		],
		effort: "none",
	});
	expect(pickerMode()).toContain("Auto");
});

test("Approve with Auto switches a manual conversation to Auto (#784)", async () => {
	open(detail([call(1, ["t1"])], "waiting_approval", "manual"));
	await bar();
	fireEvent.click(q().getByRole("button", { name: "More approve options" }));
	fireEvent.click(await until(() => q().getByRole("menuitem", { name: "Approve with Auto" })));
	await until(() => expect(approve).toHaveBeenCalled());
	expect(approve).toHaveBeenCalledWith("p1", "c1", { approve: true, mode: "auto", effort: "none" });
	await until(() => expect(pickerMode()).toContain("Auto"));
});

test("a plan's plain Start still sends manual, as before (#784)", async () => {
	open(detail([reply(1, "1. add the route")], "completed", "plan"));
	await bar();
	fireEvent.click(q().getByRole("button", { name: "Approve" }));
	await until(() => expect(send).toHaveBeenCalled());
	expect(send).toHaveBeenCalledWith("p1", "c1", "Go ahead with the plan.", "manual", "none");
	expect(approve).not.toHaveBeenCalled();
});
