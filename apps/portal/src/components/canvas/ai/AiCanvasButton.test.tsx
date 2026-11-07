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
			</CanvasAiProvider>
		</QueryClientProvider>,
	);
}

const panel = () => document.body.querySelector('[aria-label="AI chat"]');

test("the AI button opens the canvas chat and closes it again", async () => {
	const view = renderButton();
	expect(panel()).toBeNull();
	fireEvent.click(view.getByRole("button", { name: "Open AI Assistant" }));
	await until(() => expect(panel()).toBeTruthy());
	await until(() => expect(panel()?.textContent).toContain("Ask the agent about this canvas"));
	fireEvent.click(view.getByRole("button", { name: "Close AI chat", expanded: true }));
	await until(() => expect(panel()).toBeNull());
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
