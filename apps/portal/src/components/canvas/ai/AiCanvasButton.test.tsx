import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// the panel links to the AI settings and the full AI page
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { authStore } = await import("@/store/auth");
const { projectSettingsKeysService } = await import("@/services/projectSettingsKeys");
const { integrationService } = await import("@/services/integrations");
const { agentConversationsService } = await import("@/services/agentConversations");
const { CanvasAiProvider, useCanvasAi } = await import("./CanvasAiContext");
const { AiCanvasButton } = await import("./AiCanvasButton");
const { CanvasChatPanel } = await import("./CanvasChatPanel");
const { useExclusiveChatPanel } = await import("./useExclusiveChatPanel");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

/** Not RTL's waitFor: it stays bound to the DOM of whichever test file loaded RTL first. */
async function until<T>(check: () => T, timeout = 2500): Promise<T> {
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

let hasModel = true;
beforeEach(() => {
	mock.restore();
	hasModel = true;
	authStore.setState((s) => {
		s.state.acl = { p1: "creator" };
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
	});
	spyOn(projectSettingsKeysService, "getAll").mockImplementation((async () =>
		hasModel ? { "settings.ai.agentConnectionId": "ai1" } : {}) as never);
	spyOn(integrationService, "getById").mockResolvedValue({
		id: "ai1",
		name: "Claude",
		config: { model: "claude" },
	} as never);
	spyOn(agentConversationsService, "model").mockResolvedValue({ supportsThinking: false });
	spyOn(agentConversationsService, "list").mockResolvedValue([
		{
			id: "c1",
			title: "Fix the SQL",
			status: "completed",
			archived: false,
			updatedAt: new Date().toISOString(),
		},
		{
			id: "c2",
			title: "Old one",
			status: "idle",
			archived: true,
			updatedAt: new Date().toISOString(),
		},
	] as never);
});

let ai: ReturnType<typeof useCanvasAi>;
function Probe() {
	ai = useCanvasAi();
	return null;
}

function renderButton() {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<CanvasAiProvider projectId="p1" review={{ kind: "route", id: "r1" }}>
				<Probe />
				<AiCanvasButton />
				<CanvasChatPanel />
			</CanvasAiProvider>
		</QueryClientProvider>,
	);
}

/** The chat panel while it is open; it stays mounted (and hidden) when closed, to slide. */
const panel = () => document.body.querySelector('aside[aria-label="AI chat"][aria-hidden="false"]');

test("the AI button opens the canvas chat and closes it again", async () => {
	const view = renderButton();
	expect(panel()).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "Open AI Assistant" }));
	await until(() => expect(panel()).toBeTruthy());
	await until(() => expect(panel()?.textContent).toContain("Ask the agent about this canvas"));
	fireEvent.click(view.getByRole("button", { name: "Close AI chat", expanded: true }));
	await until(() => expect(panel()).toBeNull());
	// and from its own collapse button
	fireEvent.click(view.getByRole("button", { name: "Open AI Assistant" }));
	await until(() => expect(panel()).toBeTruthy());
	fireEvent.click(view.getByRole("button", { name: "Collapse AI chat panel" }));
	await until(() => expect(panel()).toBeNull());
});

test("it is a resizable side panel like Diagnostics", async () => {
	const view = renderButton();
	fireEvent.click(view.getByRole("button", { name: "Open AI Assistant" }));
	const aside = await until(() => panel() as HTMLElement);
	expect(aside.className).toContain("fx-panel--open");
	expect(view.getByRole("separator", { name: "Resize AI chat panel" })).toBeTruthy();
});

test("the toggle at the top left slides the project's chats over 40% of the chat", async () => {
	const view = renderButton();
	fireEvent.click(view.getByRole("button", { name: "Open AI Assistant" }));
	await until(() => expect(panel()).toBeTruthy());
	const toggle = view.getByRole("button", { name: "Conversations" });
	// first in the header, before the title
	expect(panel()?.querySelector("header button")).toBe(toggle);
	const drawer = () =>
		panel()
			?.querySelector('ul[aria-label="Conversations"]')
			?.closest("div.absolute") as HTMLElement;
	// out of view and out of the tab order until toggled
	await until(() => expect(drawer().className).toContain("-translate-x-full"));
	expect(drawer().hasAttribute("inert")).toBe(true);

	fireEvent.click(toggle);
	expect(toggle.getAttribute("aria-pressed")).toBe("true");
	expect(drawer().className).toContain("w-2/5");
	expect(drawer().className).toContain("translate-x-0");
	expect(drawer().hasAttribute("inert")).toBe(false);
	// the chat stays behind it
	expect(panel()?.textContent).toContain("Ask the agent about this canvas");
	expect(drawer().textContent).toContain("Fix the SQL");
	// archived chats are left out
	expect(drawer().textContent).not.toContain("Old one");

	// the dimmed rest closes it
	fireEvent.click(view.getByRole("button", { name: "Close conversations" }));
	expect(toggle.getAttribute("aria-pressed")).toBe("false");

	fireEvent.click(toggle);
	fireEvent.click(view.getByRole("button", { name: /Fix the SQL/ }));
	await until(() => expect(ai?.chat.conversationId).toBe("c1"));
	expect(toggle.getAttribute("aria-pressed")).toBe("false");
});

// the prompt's text itself is PromptEditor's `value`, covered by its own tests
test("a chat opened with a draft is a new chat holding it", async () => {
	renderButton();
	act(() => ai?.chat.setConversation("c-old"));
	act(() => ai?.chat.open("Fix the SQL in db_native_1"));
	await until(() => expect(panel()?.textContent).toContain("Ask the agent about this canvas"));
	expect(ai?.chat.conversationId).toBeUndefined();
	expect(ai?.chat.draft).toBe("Fix the SQL in db_native_1");
});

test("with no AI connection the chat points at the AI settings", async () => {
	hasModel = false;
	const view = renderButton();
	fireEvent.click(view.getByRole("button", { name: "Open AI Assistant" }));
	await until(() => expect(panel()?.textContent).toContain("Open AI settings"));
});

test("outside a wired canvas the button does nothing and opens no chat", async () => {
	const view = render(<AiCanvasButton />);
	fireEvent.click(view.getByRole("button", { name: "Open AI Assistant" }));
	await act(() => new Promise((r) => setTimeout(r, 40)));
	expect(panel()).toBeNull();
});

/** Stand-ins for Diagnostics and the block settings, to watch the chat close them. */
function Panels(props: {
	diagnostics: { isPanelOpen: boolean; closePanel: () => void };
	block: { openBlockId: string | null; close: () => void };
}) {
	useExclusiveChatPanel(props.diagnostics, props.block);
	return null;
}

test("one side panel at a time: the chat closes Diagnostics and settings, and they close it", async () => {
	const closeDiagnostics = mock(() => undefined);
	const closeBlock = mock(() => undefined);
	const tree = (diagnosticsOpen: boolean) => (
		<QueryClientProvider client={new QueryClient()}>
			<CanvasAiProvider projectId="p1">
				<Probe />
				<Panels
					diagnostics={{ isPanelOpen: diagnosticsOpen, closePanel: closeDiagnostics }}
					block={{ openBlockId: null, close: closeBlock }}
				/>
			</CanvasAiProvider>
		</QueryClientProvider>
	);
	const view = render(tree(true));
	act(() => ai?.chat.open());
	await until(() => expect(closeDiagnostics).toHaveBeenCalled());
	expect(closeBlock).toHaveBeenCalled();

	view.rerender(tree(false));
	expect(ai?.chat.isOpen).toBe(true);
	view.rerender(tree(true));
	await until(() => expect(ai?.chat.isOpen).toBe(false));
});
