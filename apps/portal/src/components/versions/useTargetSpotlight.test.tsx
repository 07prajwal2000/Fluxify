import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
Element.prototype.scrollIntoView = () => {};

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { authStore } = await import("@/store/auth");
const { routesService } = await import("@/services/routes");
const { useTargetSpotlight } = await import("./useTargetSpotlight");

function mount(props: { onGoHistory: () => void; onOpenSandbox: (sandboxId: string) => void }) {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<Harness {...props} />
		</QueryClientProvider>,
	);
}

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

function setRole(role: "viewer" | "creator") {
	authStore.setState((s) => {
		s.state.acl = { p1: role };
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
	});
}

function Harness({
	onGoHistory,
	onOpenSandbox,
}: {
	onGoHistory: () => void;
	onOpenSandbox: (sandboxId: string) => void;
}) {
	const spotlight = useTargetSpotlight({
		kind: "route",
		id: "r1",
		projectId: "p1",
		name: "Orders",
		goToHistory: onGoHistory,
		openSandbox: onOpenSandbox,
	});
	const commands = spotlight.commands({ hasUnsavedChanges: false, saveChanges: async () => true });
	return (
		<>
			{commands.map((command) => (
				<button key={command.id} type="button" onClick={command.onSelect}>
					{command.title}
				</button>
			))}
			{spotlight.dialogs}
		</>
	);
}

const button = (name: string) =>
	[...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === name)!;

beforeEach(() => {
	setRole("creator");
	spyOn(routesService, "getById").mockResolvedValue({
		id: "r1",
		projectId: "p1",
		name: "Orders",
		method: "GET",
		path: "/orders",
	} as never);
});

test("the target's palette offers version history, commit and sandbox", () => {
	mount({ onGoHistory: () => {}, onOpenSandbox: () => {} });
	expect(button("Go to version history")).toBeTruthy();
	expect(button("Commit…")).toBeTruthy();
	expect(button("Open in sandbox")).toBeTruthy();
});

test("Go to version history runs the page's navigation", () => {
	const go = mock(() => undefined);
	mount({ onGoHistory: go, onOpenSandbox: () => {} });
	fireEvent.click(button("Go to version history"));
	expect(go).toHaveBeenCalled();
});

test("Commit opens the commit dialog", () => {
	mount({ onGoHistory: () => {}, onOpenSandbox: () => {} });
	fireEvent.click(button("Commit…"));
	expect(document.body.textContent).toContain("Commit a version");
});

test("Open in sandbox prompts, then hands back the new sandbox", () => {
	mount({ onGoHistory: () => {}, onOpenSandbox: () => {} });
	fireEvent.click(button("Open in sandbox"));
	expect(document.body.textContent).toContain("Create sandbox");
});

test("a viewer is not offered Open in sandbox", () => {
	setRole("viewer");
	mount({ onGoHistory: () => {}, onOpenSandbox: () => {} });
	expect(button("Go to version history")).toBeTruthy();
	expect(
		[...document.body.querySelectorAll("button")].some(
			(b) => b.textContent?.trim() === "Open in sandbox",
		),
	).toBe(false);
});
