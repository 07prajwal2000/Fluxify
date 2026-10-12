import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
Element.prototype.scrollIntoView = () => {};

const navigate = mock();
const router = await import("@tanstack/react-router");
// the entity the page is about; a route/workflow page has one, the layout does not
let params: Record<string, string> = { projectId: "p1" };
mock.module("@tanstack/react-router", () => ({
	...router,
	useNavigate: () => navigate,
	useParams: () => params,
}));
mock.module("@/query/projectsQuery", () => ({
	projectsQuery: {
		getAll: {
			useQuery: () => ({
				data: {
					data: [
						{ id: "p1", name: "Current", description: null },
						{ id: "p2", name: "Billing", description: null },
					],
				},
			}),
		},
	},
}));
const basicList = mock((_projectId: string, enabled?: boolean) => ({
	data: enabled
		? [{ id: "i1", name: "Main DB", group: "database", variant: "PostgreSQL" }]
		: undefined,
}));
const actualIntegrationsQuery = await import("@/query/integrationsQuery");
mock.module("@/query/integrationsQuery", () => ({
	...actualIntegrationsQuery,
	integrationsQuery: {
		...actualIntegrationsQuery.integrationsQuery,
		getBasicList: { useQuery: basicList },
	},
}));
const mockSandboxes = [{ id: "s1", name: "my scratch" }];
const { authStore } = await import("@/store/auth");
mock.module("@/components/canvas/spotlight/useSpotlightResources", () => ({
	useSpotlightResources: () => {
		const role = authStore.getState().state.acl.p1;
		const canEdit = role !== "viewer";
		return {
			projectId: "p1",
			routes: [],
			workflows: [],
			customBlocks: [],
			sandboxes: canEdit ? mockSandboxes : [],
		};
	},
}));
mock.module("@/components/canvas/blocks/useCustomBlockDefs", () => ({
	useCustomBlockDefs: () => [],
	useAddableCustomBlockDefs: () => [],
}));

// `screen` stays bound to the document of whichever test file loaded RTL first,
// so query through what render() returns instead.
const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { routesService } = await import("@/services/routes");
const { middlewaresService } = await import("@/services/middlewares");
const { ProjectSpotlight } = await import("./ProjectSpotlight");

function setRole(role: "creator" | "viewer") {
	authStore.setState((s) => {
		s.state.acl = { p1: role };
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
	});
}

afterEach(() => {
	cleanup();
	mock.restore();
	navigate.mockClear();
	basicList.mockClear();
	params = { projectId: "p1" };
	authStore.setState((s) => {
		s.state.acl = {};
		s.state.userData = { id: "", name: "", email: "", image: "" };
	});
});
afterAll(() => GlobalRegistrator.unregister());

function setup(isOpen: boolean, role: "creator" | "viewer" = "creator") {
	setRole(role);
	spyOn(routesService, "getById").mockResolvedValue({
		id: "r1",
		projectId: "p1",
		name: "Orders",
		method: "GET",
		path: "/orders",
	} as never);
	spyOn(middlewaresService, "getForRoute").mockResolvedValue([] as never);
	const onOpenChange = mock();
	const onSignOut = mock();
	const ui = render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ProjectSpotlight isOpen={isOpen} onOpenChange={onOpenChange} onSignOut={onSignOut} />
		</QueryClientProvider>,
	);
	return { onOpenChange, onSignOut, ui };
}

test("Ctrl+K and Ctrl+Space open it", () => {
	const { onOpenChange } = setup(false);
	fireEvent.keyDown(document, { key: "k", ctrlKey: true });
	fireEvent.keyDown(document, { key: " ", code: "Space", ctrlKey: true });
	expect(onOpenChange.mock.calls).toEqual([[true], [true]]);
});

test("project commands only, no canvas ones", () => {
	const { ui } = setup(true);
	expect(ui.getByText("Go to: Executions")).toBeTruthy();
	expect(ui.getByText("Create Route")).toBeTruthy();
	expect(ui.getByText("Sign out")).toBeTruthy();
	expect(ui.queryByText("add >")).toBeNull();
	expect(ui.queryByText(/^Add Block/)).toBeNull();
});

test("on a route page, the spotlight offers version history, commit and sandbox", () => {
	params = { projectId: "p1", routeId: "r1" };
	const { ui } = setup(true);
	expect(ui.getByText("Go to version history")).toBeTruthy();
	expect(ui.getByText("Commit…")).toBeTruthy();
	expect(ui.getByText("Open in sandbox")).toBeTruthy();
	fireEvent.click(ui.getByText("Go to version history"));
	expect(navigate).toHaveBeenCalledWith({
		to: "/$projectId/canvas/$routeId/versions",
		params: { projectId: "p1", routeId: "r1" },
	});
});

test("a project-wide page has no target actions", () => {
	const { ui } = setup(true);
	expect(ui.queryByText("Go to version history")).toBeNull();
});

test("create opens in place, not in a new tab", () => {
	const open = mock();
	window.open = open as unknown as typeof window.open;
	const { onOpenChange, ui } = setup(true);
	fireEvent.click(ui.getByText("Create Route"));
	expect(onOpenChange).toHaveBeenCalledWith(false);
	expect(navigate).toHaveBeenCalledWith({
		to: "/$projectId/routes/new",
		params: { projectId: "p1" },
		search: undefined,
	});
	expect(open).not.toHaveBeenCalled();
});

test("switch project lists the others, not the current one", () => {
	const { ui } = setup(true);
	fireEvent.change(ui.getByRole("textbox"), { target: { value: "project" } });
	expect(ui.queryByText("Project: Current")).toBeNull();
	fireEvent.click(ui.getByText("Project: Billing"));
	expect(navigate).toHaveBeenCalledWith({ to: "/$projectId/routes", params: { projectId: "p2" } });
});

test("sign out calls through", () => {
	const { onSignOut, ui } = setup(true);
	fireEvent.click(ui.getByText("Sign out"));
	expect(onSignOut).toHaveBeenCalled();
});

test("integrations are fetched on the first search, not before", () => {
	const { ui } = setup(true);
	expect(basicList.mock.calls.every((call) => call[1] === false)).toBe(true);
	fireEvent.change(ui.getByRole("textbox"), { target: { value: "integration" } });
	expect(basicList.mock.calls.at(-1)?.[1]).toBe(true);
	fireEvent.click(ui.getByText("Integration: Main DB"));
	expect(navigate).toHaveBeenCalledWith({
		to: "/$projectId/integrations/$integrationId",
		params: { projectId: "p1", integrationId: "i1" },
	});
});

test("sandboxes show and filter, open navigates", () => {
	const { ui, onOpenChange } = setup(true, "creator");
	fireEvent.change(ui.getByRole("textbox"), { target: { value: "scratch" } });
	expect(ui.getByText("Sandbox: my scratch")).toBeTruthy();
	fireEvent.click(ui.getByText("Sandbox: my scratch"));
	expect(onOpenChange).toHaveBeenCalledWith(false);
	expect(navigate).toHaveBeenCalledWith({
		to: "/$projectId/sandbox-canvas/$sandboxId",
		params: { projectId: "p1", sandboxId: "s1" },
	});
});

test("viewer sees no sandboxes and no create sandbox command", () => {
	const { ui } = setup(true, "viewer");
	fireEvent.change(ui.getByRole("textbox"), { target: { value: "scratch" } });
	expect(ui.queryByText("Sandbox: my scratch")).toBeNull();
	fireEvent.change(ui.getByRole("textbox"), { target: { value: "sandbox" } });
	expect(ui.queryByText("Sandbox: my scratch")).toBeNull();
	expect(ui.queryByText("Create Sandbox")).toBeNull();
	expect(ui.queryByText("Go to: Sandboxes")).toBeNull();
});
