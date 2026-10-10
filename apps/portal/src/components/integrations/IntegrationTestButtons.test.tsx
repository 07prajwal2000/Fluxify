import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { authStore } = await import("@/store/auth");
const { integrationService } = await import("@/services/integrations");
const { IntegrationTestButtons } = await import("./IntegrationTestButtons");

let existingSpy: ReturnType<typeof spyOn>;
let prodSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
	existingSpy = spyOn(integrationService, "testExistingConnection").mockResolvedValue({
		success: true,
	} as never);
	prodSpy = spyOn(integrationService, "testProductionConnection").mockResolvedValue({
		success: true,
	} as never);
});

afterEach(() => {
	cleanup();
	existingSpy.mockRestore();
	prodSpy.mockRestore();
});

afterAll(() => GlobalRegistrator.unregister());

function renderWithRole(role: "viewer" | "creator" | "project_admin") {
	authStore.setState((s) => {
		s.state.acl = { "proj-1": role };
		s.state.userData = { id: "u", name: "User", email: "u@fluxify.io", isSystemAdmin: false };
	});
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<IntegrationTestButtons projectId="proj-1" integrationId="integ-123" />
		</QueryClientProvider>,
	);
}

test("viewers see only Test connection, not Test production credentials", () => {
	const view = renderWithRole("viewer");

	expect(view.getByText("Test connection")).toBeTruthy();
	expect(view.queryByText("Test production credentials")).toBeNull();
});

test("creators see Test production credentials and clicking it calls the prod endpoint", async () => {
	const view = renderWithRole("creator");

	const prodBtn = view.getByText("Test production credentials");
	expect(prodBtn).toBeTruthy();

	await act(async () => {
		fireEvent.click(prodBtn);
		await new Promise((r) => setTimeout(r, 10));
	});

	expect(prodSpy).toHaveBeenCalledWith("proj-1", "integ-123");
	expect(existingSpy).not.toHaveBeenCalled();
});

test("clicking Test connection calls the dev endpoint", async () => {
	const view = renderWithRole("creator");

	const devBtn = view.getByText("Test connection");
	expect(devBtn).toBeTruthy();

	await act(async () => {
		fireEvent.click(devBtn);
		await new Promise((r) => setTimeout(r, 10));
	});

	expect(existingSpy).toHaveBeenCalledWith("proj-1", "integ-123");
	expect(prodSpy).not.toHaveBeenCalled();
});
