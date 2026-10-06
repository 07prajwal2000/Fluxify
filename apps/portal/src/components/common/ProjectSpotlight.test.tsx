import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
Element.prototype.scrollIntoView = () => {};

const navigate = mock();
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useNavigate: () => navigate,
	useParams: () => ({ projectId: "p1" }),
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
const basicList = mock((_projectId: string, _forHarness?: boolean, enabled?: boolean) => ({
	data: enabled
		? [{ id: "i1", name: "Main DB", group: "database", variant: "PostgreSQL" }]
		: undefined,
}));
mock.module("@/query/integrationsQuery", () => ({
	integrationsQuery: { getBasicList: { useQuery: basicList } },
}));
mock.module("@/components/canvas/spotlight/useSpotlightResources", () => ({
	useSpotlightResources: () => ({ projectId: "p1", routes: [], workflows: [], customBlocks: [] }),
}));
mock.module("@/components/canvas/blocks/useCustomBlockDefs", () => ({
	useCustomBlockDefs: () => [],
	useAddableCustomBlockDefs: () => [],
}));

// `screen` stays bound to the document of whichever test file loaded RTL first,
// so query through what render() returns instead.
const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { ProjectSpotlight } = await import("./ProjectSpotlight");

afterEach(() => {
	cleanup();
	navigate.mockClear();
	basicList.mockClear();
});
afterAll(() => GlobalRegistrator.unregister());

function setup(isOpen: boolean) {
	const onOpenChange = mock();
	const onSignOut = mock();
	const ui = render(
		<ProjectSpotlight isOpen={isOpen} onOpenChange={onOpenChange} onSignOut={onSignOut} />,
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
	expect(basicList.mock.calls.every((call) => call[2] === false)).toBe(true);
	fireEvent.change(ui.getByRole("textbox"), { target: { value: "integration" } });
	expect(basicList.mock.calls.at(-1)?.[2]).toBe(true);
	fireEvent.click(ui.getByText("Integration: Main DB"));
	expect(navigate).toHaveBeenCalledWith({
		to: "/$projectId/integrations/$integrationId",
		params: { projectId: "p1", integrationId: "i1" },
	});
});
