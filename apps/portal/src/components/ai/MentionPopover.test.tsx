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
const { projectSettingsKeysQuery } = await import("@/query/projectSettingsKeysQuery");
const { integrationsQuery } = await import("@/query/integrationsQuery");
const { MentionPopover } = await import("./MentionPopover");

const settingsSpy = spyOn(projectSettingsKeysQuery.getAll, "useQuery");
const integrationsSpy = spyOn(integrationsQuery.getAll, "useQuery");

beforeEach(() => {
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
	GlobalRegistrator.unregister();
});

test("@ menu filters to allowed servers in settings", () => {
	const view = render(<MentionPopover projectId="p1" wasAtTyped={true} onClose={() => {}} />);
	// Only mcp-1 ("github") is in settings.ai.agentMcpIntegrations
	expect(view.getByText("@github")).not.toBeNull();
	expect(view.queryByText("@slack")).toBeNull();
});

test("search filters allowed servers by name", () => {
	const view = render(<MentionPopover projectId="p1" wasAtTyped={true} onClose={() => {}} />);
	const input = view.getByPlaceholderText("Search servers...");
	fireEvent.change(input, { target: { value: "git" } });
	expect(view.getByText("@github")).not.toBeNull();

	fireEvent.change(input, { target: { value: "nomatch" } });
	expect(view.getByText("No matching servers found")).not.toBeNull();
});

test("keyboard navigation and Enter picks server and dispatches insert-resource", () => {
	let insertedDetail: any = null;
	const handler = (e: Event) => {
		insertedDetail = (e as CustomEvent).detail;
	};
	document.addEventListener("insert-resource", handler);
	const onClose = mock();

	const view = render(<MentionPopover projectId="p1" wasAtTyped={true} onClose={onClose} />);
	const input = view.getByPlaceholderText("Search servers...");

	fireEvent.keyDown(input, { key: "ArrowDown" });
	fireEvent.keyDown(input, { key: "Enter" });
	document.removeEventListener("insert-resource", handler);

	expect(insertedDetail).not.toBeNull();
	expect(insertedDetail.res).toEqual({
		type: "integration",
		id: "mcp-1",
		name: "github",
		label: "@github",
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
	const input = view.getByPlaceholderText("Search servers...");
	fireEvent.keyDown(input, { key: "Escape" });
	document.removeEventListener("focus-editor", handler);

	expect(onClose).toHaveBeenCalled();
	expect(focused).toBe(true);
});
