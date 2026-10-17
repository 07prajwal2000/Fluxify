import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

try {
	GlobalRegistrator.register({ url: "http://localhost:5601/" });
} catch {}

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { AiConnectionsSettings } = await import("./AiConnectionsSettings");
const { projectSettingsKeysService } = await import("@/services/projectSettingsKeys");
const { integrationsQuery } = await import("@/query/integrationsQuery");
const { knowledgeSourcesQuery } = await import("@/query/knowledgeSourcesQuery");
const { integrationService } = await import("@/services/integrations");
const { authStore } = await import("@/store/auth");

const upsert = spyOn(projectSettingsKeysService, "upsert");
const integrationsSpy = spyOn(integrationsQuery.getAll, "useQuery");
const knowledgeSpy = spyOn(knowledgeSourcesQuery.getAll, "useQuery");
const loadIntegrationsSpy = spyOn(integrationService, "getAll");
const tick = () => act(() => new Promise((r) => setTimeout(r, 50)));

beforeEach(() => {
	upsert.mockReset().mockResolvedValue({} as never);
	loadIntegrationsSpy.mockResolvedValue([]);
	knowledgeSpy.mockReturnValue({ data: [], isLoading: false } as never);
	integrationsSpy.mockImplementation(((_pid: string, group: string) => ({
		data:
			group === "mcp"
				? [
						{
							id: "mcp-server-1",
							name: "local-math",
							group: "mcp",
							variant: "http",
							config: { url: "http://localhost:8000/sse" },
						},
					]
				: [],
		isLoading: false,
		isFetching: false,
		refetch: () => Promise.resolve(),
	})) as never);
});

afterEach(cleanup);
afterAll(() => {
	upsert.mockRestore();
	integrationsSpy.mockRestore();
	knowledgeSpy.mockRestore();
	loadIntegrationsSpy.mockRestore();
	GlobalRegistrator.unregister();
});

function setup(role: "viewer" | "creator" | "project_admin" = "project_admin") {
	authStore
		.getState()
		.actions.setUserData({ id: "u1", name: "U", email: "u@x.io", isSystemAdmin: false });
	authStore.getState().actions.setACL([{ projectId: "p1", role }]);
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<AiConnectionsSettings projectId="p1" />
		</QueryClientProvider>,
	);
}

test("shows existing connected MCP server and deleted indicator for non-existent server", async () => {
	const { projectSettingsKeysQuery } = await import("@/query/projectSettingsKeysQuery");
	const originalUseQuery = projectSettingsKeysQuery.getAll.useQuery;
	projectSettingsKeysQuery.getAll.useQuery = (() => ({
		data: {
			"settings.ai.agentMcpIntegrations": "mcp-server-1,deleted-server-99",
		},
		isLoading: false,
	})) as never;

	const view = setup("project_admin");

	// Existing server
	expect(view.getByText("local-math")).toBeDefined();
	expect(view.getByText("http://localhost:8000/sse")).toBeDefined();

	// Deleted server indicator
	expect(view.getByText("Unknown Server")).toBeDefined();
	expect(view.getByText("Deleted")).toBeDefined();
	expect(view.getByText("deleted-server-99")).toBeDefined();
	expect(view.getByText("This integration was deleted from the project.")).toBeDefined();

	projectSettingsKeysQuery.getAll.useQuery = originalUseQuery;
});

test("removing a deleted server reference removes it from settings", async () => {
	const { projectSettingsKeysQuery } = await import("@/query/projectSettingsKeysQuery");
	const originalUseQuery = projectSettingsKeysQuery.getAll.useQuery;
	projectSettingsKeysQuery.getAll.useQuery = (() => ({
		data: {
			"settings.ai.agentMcpIntegrations": "mcp-server-1,deleted-server-99",
		},
		isLoading: false,
	})) as never;

	const view = setup("project_admin");

	const removeBtn = view.getByRole("button", {
		name: "Remove deleted reference deleted-server-99",
	});
	await act(async () => {
		fireEvent.click(removeBtn);
	});
	await tick();

	expect(upsert).toHaveBeenCalledWith("p1", {
		key: "settings.ai.agentMcpIntegrations",
		value: "mcp-server-1",
	});

	projectSettingsKeysQuery.getAll.useQuery = originalUseQuery;
});
