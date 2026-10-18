import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

try {
	GlobalRegistrator.register();
} catch {}
Element.prototype.scrollIntoView = () => {};

const mockSettings = { "settings.ai.agentMcpIntegrations": "mcp-1" };
const mockServers = [
	{ id: "mcp-1", name: "github", description: "GitHub MCP server" },
	{ id: "mcp-2", name: "slack", description: "Slack MCP server" },
];

const { cleanup, fireEvent, render } = await import("@testing-library/react");
const resourceSearch = await import("@/query/resourceSearchQuery");
const { projectSettingsKeysQuery } = await import("@/query/projectSettingsKeysQuery");
const { integrationsQuery } = await import("@/query/integrationsQuery");
const { MentionPopover } = await import("./MentionPopover");

const settingsSpy = spyOn(projectSettingsKeysQuery.getAll, "useQuery");
const integrationsSpy = spyOn(integrationsQuery.getAll, "useQuery");
const searchSpy = spyOn(resourceSearch, "useResourceSearch");
const routes = [{ type: "route", id: "r1", name: "Orders", label: "Orders" }];

beforeEach(() => {
	searchSpy.mockReturnValue({ results: routes, isLoading: false, isFetching: false } as never);
	settingsSpy.mockReturnValue({ data: mockSettings, isLoading: false } as never);
	integrationsSpy.mockImplementation(((_pid: string, group: string) => ({
		data: group === "mcp" ? mockServers : [],
		isLoading: false,
	})) as never);
});

afterEach(cleanup);
afterAll(() => {
	settingsSpy.mockRestore();
	integrationsSpy.mockRestore();
	searchSpy.mockRestore();
	GlobalRegistrator.unregister();
});

test("@ menu filters to allowed servers in settings", () => {
	const view = render(<MentionPopover projectId="p1" wasAtTyped={true} onClose={() => {}} />);
	// Only mcp-1 ("github") is in settings.ai.agentMcpIntegrations
	expect(view.getByText("@github")).not.toBeNull();
	expect(view.queryByText("@slack")).toBeNull();
});

test("the project's resources are listed next to the allowed servers", () => {
	const view = render(<MentionPopover projectId="p1" wasAtTyped={true} onClose={() => {}} />);
	expect(view.getByText("@github")).not.toBeNull();
	expect(view.getByText("Orders")).not.toBeNull();
});

test("an MCP server from the search is not offered unless it is allowed", () => {
	searchSpy.mockReturnValue({
		results: [{ type: "integration", id: "mcp-2", name: "slack", group: "mcp" }],
		isLoading: false,
		isFetching: false,
	} as never);
	const view = render(<MentionPopover projectId="p1" wasAtTyped={true} onClose={() => {}} />);
	expect(view.queryByText("slack")).toBeNull();
	expect(view.queryByText("@slack")).toBeNull();
});

test("the search narrows the allowed servers by name", () => {
	const view = render(<MentionPopover projectId="p1" wasAtTyped={true} onClose={() => {}} />);
	fireEvent.change(view.getByPlaceholderText("Search resources..."), { target: { value: "zzz" } });
	expect(view.queryByText("@github")).toBeNull();
});

test("Enter picks the highlighted server and dispatches insert-resource", () => {
	let insertedDetail: any = null;
	const handler = (e: Event) => {
		insertedDetail = (e as CustomEvent).detail;
	};
	document.addEventListener("insert-resource", handler);
	const onClose = mock();

	const view = render(<MentionPopover projectId="p1" wasAtTyped={true} onClose={onClose} />);
	const input = view.getByPlaceholderText("Search resources...");

	fireEvent.keyDown(input, { key: "Enter" });
	document.removeEventListener("insert-resource", handler);

	expect(insertedDetail).not.toBeNull();
	expect(insertedDetail.res).toEqual({
		type: "integration",
		id: "mcp-1",
		name: "github",
		label: "@github",
		description: undefined,
	});
	expect(insertedDetail.wasAtTyped).toBe(true);
	expect(onClose).toHaveBeenCalled();
});

test("Escape key closes popover and focuses editor", () => {
	let focused = false;
	const handler = () => {
		focused = true;
	};
	document.addEventListener("focus-editor", handler);
	const onClose = mock();

	const view = render(<MentionPopover projectId="p1" wasAtTyped={true} onClose={onClose} />);
	const input = view.getByPlaceholderText("Search resources...");
	fireEvent.keyDown(input, { key: "Escape" });
	document.removeEventListener("focus-editor", handler);

	expect(onClose).toHaveBeenCalled();
	expect(focused).toBe(true);
});
