import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { integrationService } = await import("@/services/integrations");
const { McpOAuthConnect } = await import("./McpOAuthConnect");

const SIGN_IN = "https://mcp.example.com/authorize?state=abc";
let connectSpy: ReturnType<typeof spyOn>;
let disconnectSpy: ReturnType<typeof spyOn>;
let assignSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
	connectSpy = spyOn(integrationService, "connectMcpOAuth").mockResolvedValue({
		authorizationUrl: SIGN_IN,
	});
	disconnectSpy = spyOn(integrationService, "disconnectMcpOAuth").mockResolvedValue();
	assignSpy = spyOn(window.location, "assign").mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
	connectSpy.mockRestore();
	disconnectSpy.mockRestore();
	assignSpy.mockRestore();
});

afterAll(() => GlobalRegistrator.unregister());

const target = (over: Partial<{ canConnect: boolean; saved: boolean }> = {}) => ({
	integrationId: "integ-1",
	env: "production" as const,
	canConnect: true,
	saved: true,
	...over,
});

function show(props: Parameters<typeof McpOAuthConnect>[0]) {
	const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<McpOAuthConnect {...props} />
		</QueryClientProvider>,
	);
}

test("before the integration is saved there is no Connect, only the way to get one", () => {
	const view = show({ projectId: "p1" });
	expect(view.getByText("Save the integration first, then Connect.")).toBeTruthy();
	expect(view.queryByText("Connect")).toBeNull();
	expect(view.getByText("Not connected")).toBeTruthy();
});

test("saved with headers still: save with OAuth first", () => {
	const view = show({ projectId: "p1", target: target({ saved: false }) });
	expect(view.getByText("Save the integration with OAuth first, then Connect.")).toBeTruthy();
	expect(view.queryByText("Connect")).toBeNull();
});

test("says it is one shared account and to use a company account", () => {
	const view = show({ projectId: "p1", target: target() });
	expect(view.getByText(/One shared account/)).toBeTruthy();
	expect(view.getByText(/company or service/)).toBeTruthy();
});

test("an admin connects: the browser goes to the MCP server's sign in", async () => {
	const view = show({ projectId: "p1", target: target(), status: { connected: false } });
	expect(view.getByText("Not connected")).toBeTruthy();
	await act(async () => {
		fireEvent.click(view.getByText("Connect"));
		await new Promise((r) => setTimeout(r, 10));
	});
	expect(connectSpy).toHaveBeenCalledWith("p1", "integ-1", "production");
	expect(assignSpy).toHaveBeenCalledWith(SIGN_IN);
	expect(view.queryByText("Disconnect")).toBeNull();
});

test("connected shows the status, Reconnect and Disconnect, and Disconnect asks first", async () => {
	const view = show({
		projectId: "p1",
		target: target(),
		status: { connected: true, expiresAt: Date.now() + 60_000 },
	});
	expect(view.getByText("Connected")).toBeTruthy();
	expect(view.getByText("Reconnect")).toBeTruthy();
	await act(async () => {
		fireEvent.click(view.getByText("Disconnect"));
	});
	expect(disconnectSpy).not.toHaveBeenCalled();
	const confirm = await waitFor(() => view.getAllByText("Disconnect").at(-1)!);
	await act(async () => {
		fireEvent.click(confirm);
		await new Promise((r) => setTimeout(r, 10));
	});
	expect(disconnectSpy).toHaveBeenCalledWith("p1", "integ-1", "production");
});

test("a creator sees the status and cannot connect or disconnect", () => {
	const view = show({
		projectId: "p1",
		target: target({ canConnect: false }),
		status: { connected: true },
	});
	expect(view.getByText("Connected")).toBeTruthy();
	expect(view.queryByText("Reconnect")).toBeNull();
	expect(view.queryByText("Disconnect")).toBeNull();
	expect(view.getByText("Only project admins can connect or disconnect.")).toBeTruthy();
});
