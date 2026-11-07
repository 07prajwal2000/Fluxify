import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// the "set an AI connection" hint links to project settings
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
const { agentReviewsService } = await import("@/services/agentReviews");
const { projectSettingsKeysService } = await import("@/services/projectSettingsKeys");
const { integrationService } = await import("@/services/integrations");
const { CanvasAiProvider, useCanvasAi } = await import("./CanvasAiContext");
const { AiReviewSection, fixPrompt } = await import("./AiReviewSection");

afterEach(() => {
	cleanup();
	localStorage.clear();
});
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

const finding = {
	severity: "error" as const,
	category: "security" as const,
	message: "The body name goes straight into the SQL text.",
	suggestedFix: "Pass it as $1.",
	blockKeys: ["db_native_1"],
	blockIds: ["b-sql"],
};
const review = (over: object = {}) => ({
	id: "rev1",
	kind: "route" as const,
	targetId: "r1",
	status: "completed" as const,
	summary: "Searches users by name.",
	findings: [finding],
	error: null,
	canvasRevision: 3,
	createdAt: "2026-11-07T10:00:00.000Z",
	completedAt: "2026-11-07T10:00:30.000Z",
	stale: false,
	...over,
});

function setRole(role: "viewer" | "creator") {
	authStore.setState((s) => {
		s.state.acl = { p1: role };
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
	});
}

let hasModel = true;
beforeEach(() => {
	mock.restore();
	setRole("creator");
	hasModel = true;
	spyOn(projectSettingsKeysService, "getAll").mockImplementation((async () =>
		hasModel ? { "settings.ai.agentConnectionId": "ai1" } : {}) as never);
	spyOn(integrationService, "getById").mockResolvedValue({
		id: "ai1",
		name: "Claude",
		config: { model: "claude" },
	} as never);
});

/** What the chat would open with, read back from the context. */
let chat: ReturnType<typeof useCanvasAi>;
function Probe() {
	chat = useCanvasAi();
	return null;
}

function renderSection(review?: { kind: "route" | "workflow"; id: string }) {
	const onSelectBlock = mock(() => undefined);
	const view = render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<CanvasAiProvider projectId="p1" review={review ?? { kind: "route", id: "r1" }}>
				<Probe />
				<AiReviewSection onSelectBlock={onSelectBlock} />
			</CanvasAiProvider>
		</QueryClientProvider>,
	);
	return { view, onSelectBlock };
}

const text = () => document.body.textContent ?? "";
const button = (name: string) =>
	until(() => {
		const b = [...document.body.querySelectorAll("button")].find(
			(x) => x.textContent?.trim() === name,
		);
		if (!b) throw new Error(`no ${name} button`);
		return b as HTMLButtonElement;
	});

test("before the first review it explains itself and offers to start one", async () => {
	spyOn(agentReviewsService, "get").mockResolvedValue(null);
	renderSection();
	await until(() => expect(text()).toContain("It only reads"));
	expect(await button("Review with AI")).toBeTruthy();
});

test("starting a review shows it running, with Cancel instead of a second start", async () => {
	spyOn(agentReviewsService, "get").mockResolvedValue(null);
	const start = spyOn(agentReviewsService, "start").mockResolvedValue(
		review({ status: "running", summary: null, findings: null }) as never,
	);
	const stop = spyOn(agentReviewsService, "stop").mockResolvedValue(
		review({ status: "cancelled" }) as never,
	);
	renderSection();
	fireEvent.click(await button("Review with AI"));
	await until(() => expect(text()).toContain("You can keep editing or leave this page"));
	expect(start).toHaveBeenCalledWith("p1", "route", "r1");
	fireEvent.click(await button("Cancel"));
	await until(() => expect(stop).toHaveBeenCalledWith("p1", "route", "r1"));
});

test("a finished report lists findings; clicking one opens its block", async () => {
	spyOn(agentReviewsService, "get").mockResolvedValue(review() as never);
	const { onSelectBlock } = renderSection();
	await until(() => expect(text()).toContain(finding.message));
	expect(text()).toContain("Searches users by name.");
	expect(text()).toContain("Security");
	expect(text()).toContain("db_native_1");
	expect(text()).toContain("Suggested fix");
	expect(text()).toContain("Pass it as $1.");
	expect(text()).not.toContain("older version");
	fireEvent.click(await until(() => document.querySelector("li button") as HTMLButtonElement));
	expect(onSelectBlock).toHaveBeenCalledWith("b-sql", "General");
	expect(await button("Run again")).toBeTruthy();
});

test("a finding about the whole canvas opens no block", async () => {
	spyOn(agentReviewsService, "get").mockResolvedValue(
		review({ findings: [{ ...finding, blockKeys: [], blockIds: [] }] }) as never,
	);
	const { onSelectBlock } = renderSection();
	await until(() => expect(text()).toContain("Whole route"));
	const item = document.querySelector("li button") as HTMLButtonElement;
	expect(item.disabled).toBe(true);
	fireEvent.click(item);
	expect(onSelectBlock).not.toHaveBeenCalled();
});

test("a report on an older canvas says so", async () => {
	spyOn(agentReviewsService, "get").mockResolvedValue(review({ stale: true }) as never);
	renderSection();
	await until(() => expect(text()).toContain("Reviewed an older version"));
});

test("a failed review shows why", async () => {
	spyOn(agentReviewsService, "get").mockResolvedValue(
		review({ status: "failed", error: "model is deactivated" }) as never,
	);
	renderSection();
	await until(() => expect(text()).toContain("The review failed: model is deactivated"));
});

test("Ask the agent to fix this opens a new canvas chat with the finding in its prompt", async () => {
	spyOn(agentReviewsService, "get").mockResolvedValue(review() as never);
	renderSection();
	fireEvent.click(await button("Ask the agent to fix this"));
	await until(() => expect(chat?.chat.isOpen).toBe(true));
	expect(chat?.chat.conversationId).toBeUndefined();
	expect(chat?.chat.draft).toBe(fixPrompt("route", "r1", finding, "rev1", 0));
	expect(chat?.chat.draft).toContain("in db_native_1");
	expect(chat?.chat.draft).toContain("Suggested fix: Pass it as $1.");
	// so the agent can mark it when it is done
	expect(chat?.chat.draft).toContain("resolve_review_finding with reviewId rev1 and finding 1");
});

test("a finding the agent fixed shows green, with its note and a way back to the chat", async () => {
	const resolution = { status: "fixed", note: "Added two suites", conversationId: "c9", at: "t" };
	spyOn(agentReviewsService, "get").mockResolvedValue(
		review({ findings: [{ ...finding, resolution }, finding] }) as never,
	);
	renderSection();
	await until(() => expect(text()).toContain("Fixed by the agent: Added two suites"));
	const [fixed, open] = [...document.querySelectorAll("li")];
	expect(fixed.className).toContain("bg-success/10");
	expect(fixed.querySelector('[aria-label="fixed"]')).toBeTruthy();
	expect(open.className).not.toContain("bg-success/10");
	// only the open one still offers a fix
	expect(fixed.textContent).not.toContain("Ask the agent to fix this");
	expect(open.textContent).toContain("Ask the agent to fix this");
	fireEvent.click(await button("Open chat"));
	await until(() => expect(chat?.chat.isOpen).toBe(true));
	expect(chat?.chat.conversationId).toBe("c9");
});

test("a finding the agent found wrong says so, not in green", async () => {
	spyOn(agentReviewsService, "get").mockResolvedValue(
		review({
			findings: [
				{ ...finding, resolution: { status: "not_an_issue", conversationId: "c9", at: "t" } },
			],
		}) as never,
	);
	renderSection();
	await until(() => expect(text()).toContain("The agent found this is not an issue"));
	expect(document.querySelector("li")?.className).not.toContain("bg-success/10");
});

test("a viewer reads the report but cannot start one or ask for a fix", async () => {
	setRole("viewer");
	const get = spyOn(agentReviewsService, "get").mockResolvedValue(review() as never);
	renderSection();
	await until(() => expect(text()).toContain(finding.message));
	expect(get).toHaveBeenCalled();
	expect(text()).not.toContain("Run again");
	expect(text()).not.toContain("Ask the agent to fix this");
});

test("with no AI connection, a creator is pointed at the AI settings", async () => {
	hasModel = false;
	spyOn(agentReviewsService, "get").mockResolvedValue(null);
	renderSection();
	await until(() => expect(text()).toContain("Set an AI connection to review"));
	expect(text()).not.toContain("Review with AI");
});

test("a canvas with no review target shows no section", async () => {
	const get = spyOn(agentReviewsService, "get").mockResolvedValue(null);
	render(
		<QueryClientProvider client={new QueryClient()}>
			<CanvasAiProvider projectId="p1">
				<AiReviewSection onSelectBlock={() => {}} />
			</CanvasAiProvider>
		</QueryClientProvider>,
	);
	await act(() => new Promise((r) => setTimeout(r, 40)));
	expect(text()).not.toContain("AI review");
	expect(get).not.toHaveBeenCalled();
});

test("collapsing hides the report, shows the open count and is remembered", async () => {
	spyOn(agentReviewsService, "get").mockResolvedValue(review() as never);
	renderSection();
	await until(() => expect(text()).toContain(finding.message));
	const toggle = document.querySelector("[aria-label='Collapse AI review']") as HTMLButtonElement;
	fireEvent.click(toggle);
	expect(text()).not.toContain(finding.message);
	expect(toggle.getAttribute("aria-expanded")).toBe("false");
	expect(toggle.textContent).toContain("1");
	cleanup();
	renderSection();
	await until(() => expect(document.querySelector("[aria-label='Expand AI review']")).toBeTruthy());
	expect(text()).not.toContain(finding.message);
});

test("Fix all opens one chat listing every unmarked finding by its report number", async () => {
	const resolution = { status: "fixed", conversationId: "c9", at: "t" };
	const second = { ...finding, severity: "warning" as const, message: "No error handler." };
	const third = {
		...finding,
		message: "Rows go out whole.",
		blockKeys: [],
		suggestedFix: undefined,
	};
	spyOn(agentReviewsService, "get").mockResolvedValue(
		review({ findings: [finding, { ...second, resolution }, second, third] }) as never,
	);
	renderSection();
	fireEvent.click(await button("Fix all (3)"));
	await until(() => expect(chat?.chat.isOpen).toBe(true));
	const draft = chat?.chat.draft ?? "";
	expect(draft).toContain(
		`1. [error in db_native_1] ${finding.message}\n   Suggested fix: Pass it as $1.`,
	);
	expect(draft).not.toContain("2. ");
	expect(draft).toContain("3. [warning in db_native_1] No error handler.");
	expect(draft).toContain("4. [error] Rows go out whole.");
	expect(draft).toContain("resolve_review_finding once with reviewId rev1");
});

test("Fix all needs more than one open finding, and the creator role", async () => {
	spyOn(agentReviewsService, "get").mockResolvedValue(review() as never);
	renderSection();
	await until(() => expect(text()).toContain(finding.message));
	expect(text()).not.toContain("Fix all");
	cleanup();
	setRole("viewer");
	spyOn(agentReviewsService, "get").mockResolvedValue(
		review({ findings: [finding, finding] }) as never,
	);
	renderSection();
	await until(() => expect(text()).toContain(finding.message));
	expect(text()).not.toContain("Fix all");
});
