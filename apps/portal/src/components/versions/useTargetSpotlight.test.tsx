import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
Element.prototype.scrollIntoView = () => {};

const navigate = mock();
let params: Record<string, string> = { projectId: "p1", routeId: "r1" };
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useNavigate: () => navigate,
	useParams: () => params,
}));

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { authStore } = await import("@/store/auth");
const { routesService } = await import("@/services/routes");
const { middlewaresService } = await import("@/services/middlewares");
const { useTargetSpotlight } = await import("./useTargetSpotlight");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

function setRole(role: "viewer" | "creator") {
	authStore.setState((s) => {
		s.state.acl = { p1: role };
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
	});
}

function Harness() {
	const spotlight = useTargetSpotlight();
	return (
		<>
			{spotlight.commands().map((command) => (
				<button key={command.id} type="button" onClick={command.onSelect}>
					{command.title}
				</button>
			))}
			{spotlight.dialogs}
		</>
	);
}

function mount() {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<Harness />
		</QueryClientProvider>,
	);
}

const button = (name: string) => {
	const found = [...document.body.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === name,
	);
	if (!found) throw new Error(`no button ${name}`);
	return found;
};

beforeEach(() => {
	setRole("creator");
	params = { projectId: "p1", routeId: "r1" };
	spyOn(routesService, "getById").mockResolvedValue({
		id: "r1",
		projectId: "p1",
		name: "Orders",
		method: "GET",
		path: "/orders",
	} as never);
	spyOn(middlewaresService, "getForRoute").mockResolvedValue([] as never);
});

test("the target's palette offers version history, commit and sandbox", () => {
	mount();
	expect(button("Go to version history")).toBeTruthy();
	expect(button("Commit…")).toBeTruthy();
	expect(button("Open in sandbox")).toBeTruthy();
});

test("Go to version history runs the page's navigation", () => {
	mount();
	fireEvent.click(button("Go to version history"));
	expect(navigate).toHaveBeenCalledWith({
		to: "/$projectId/canvas/$routeId/versions",
		params: { projectId: "p1", routeId: "r1" },
	});
});

test("Commit opens the commit dialog", () => {
	mount();
	fireEvent.click(button("Commit…"));
	expect(document.body.textContent).toContain("Commit a version");
});

test("Open in sandbox prompts", () => {
	mount();
	fireEvent.click(button("Open in sandbox"));
	expect(document.body.textContent).toContain("Create sandbox");
});

test("a viewer is not offered Open in sandbox", () => {
	setRole("viewer");
	mount();
	expect(button("Go to version history")).toBeTruthy();
	expect(
		[...document.body.querySelectorAll("button")].some(
			(b) => b.textContent?.trim() === "Open in sandbox",
		),
	).toBe(false);
});

test("a page with no route or workflow offers none of them", () => {
	params = { projectId: "p1" };
	mount();
	expect(
		[...document.body.querySelectorAll("button")].some(
			(b) => b.textContent?.trim() === "Go to version history",
		),
	).toBe(false);
});
