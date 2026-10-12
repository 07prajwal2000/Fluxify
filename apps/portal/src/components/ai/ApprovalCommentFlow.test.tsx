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
	PromptEditor: ({ placeholder, onSubmit, isRunning }: any) => {
		const { useState } = require("react");
		const [text, setText] = useState("");
		return (
			<div>
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
const { versionsService } = await import("@/services/versions");
const { ConversationPage } = await import("./ConversationPage");

const realObserver = globalThis.IntersectionObserver;
const saved = { io: realObserver };

/** A conversation stopped on a promote_version call, its comment still to be written. */
const waiting = () => ({
	conversation: { id: "c1", title: "t", archived: false },
	messages: [
		{ seq: 0, role: "user", runId: "r1", content: { role: "user", content: "ship it" } },
		{
			seq: 1,
			role: "assistant",
			runId: "r1",
			content: {
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "t1",
						toolName: "promote_version",
						input: { kind: "route", id: "r1", versionId: "v1" },
					},
				],
			},
		},
	],
	nextBeforeSeq: null as number | null,
	run: { id: "r1", status: "waiting_approval", stopReason: null, usage: null },
	settings: { mode: "manual", effort: "none", supportsThinking: true },
});

let get: ReturnType<typeof spyOn>;
let approve: ReturnType<typeof spyOn>;
let versions: ReturnType<typeof spyOn>;
beforeEach(() => {
	saved.io = globalThis.IntersectionObserver;
	globalThis.IntersectionObserver = class {
		observe() {}
		disconnect() {}
	} as never;
	get = spyOn(agentConversationsService, "get").mockResolvedValue(waiting() as never);
	approve = spyOn(agentConversationsService, "approve").mockResolvedValue({ runId: "r1" });
	versions = spyOn(versionsService, "list").mockResolvedValue({
		uncommitted: false,
		versions: [{ id: "v1", versionNumber: 2, title: "Add rate limiting" }],
	} as never);
});
afterEach(() => {
	cleanup();
	globalThis.IntersectionObserver = saved.io as never;
	for (const s of [get, approve, versions]) s.mockRestore();
});
afterAll(() => {
	mock.module("./PromptEditor", () => realEditor);
	GlobalRegistrator.unregister();
});

function open() {
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ConversationPage />
		</QueryClientProvider>,
	);
}
const bar = () => until(() => q().getByRole("region", { name: "Approval needed" }));
const box = () => q().getByLabelText("Why is this going live?");
const approveButton = () => q().getByRole("button", { name: "Approve" });
const disabled = (el: HTMLElement) =>
	el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";

test("a promote needs a comment, and Approve sends the typed one with the approval (#778)", async () => {
	open();
	await bar();
	// no reason, no approval
	expect(disabled(approveButton())).toBe(true);

	fireEvent.change(box(), { target: { value: "Fixes the 500s" } });
	expect(disabled(approveButton())).toBe(false);
	fireEvent.click(approveButton());
	await until(() => expect(approve).toHaveBeenCalled());
	expect(approve).toHaveBeenCalledWith("p1", "c1", {
		approve: true,
		mode: "manual",
		effort: "none",
		comment: "Fixes the 500s",
	});
	// the version reads as a link, never its uuid
	await until(() => q().getByText("v2 · Add rate limiting"));
});

test("Approve with Auto carries the typed comment too (#778)", async () => {
	open();
	await bar();
	fireEvent.change(box(), { target: { value: "Ship the fix" } });
	fireEvent.click(q().getByRole("button", { name: "More approve options" }));
	fireEvent.click(await until(() => q().getByRole("menuitem", { name: "Approve with Auto" })));
	await until(() => expect(approve).toHaveBeenCalled());
	expect(approve).toHaveBeenCalledWith("p1", "c1", {
		approve: true,
		mode: "auto",
		effort: "none",
		comment: "Ship the fix",
	});
});
