import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { WorkflowConcurrencySettings } = await import("./WorkflowConcurrencySettings");
const { projectSettingsKeysService } = await import("@/services/projectSettingsKeys");
const { authStore } = await import("@/store/auth");

const upsert = spyOn(projectSettingsKeysService, "upsert");
const getAll = spyOn(projectSettingsKeysService, "getAll");

beforeEach(() => upsert.mockReset().mockResolvedValue({} as never));
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

async function setup(
	role: "viewer" | "creator" | "project_admin",
	settings: Record<string, string> = {},
) {
	getAll.mockReset().mockResolvedValue(settings as never);
	authStore
		.getState()
		.actions.setUserData({ id: "u1", name: "U", email: "u@x.io", isSystemAdmin: false });
	authStore.getState().actions.setACL([{ projectId: "p1", role }]);
	render(
		<QueryClientProvider client={new QueryClient()}>
			<WorkflowConcurrencySettings projectId="p1" />
		</QueryClientProvider>,
	);
	await act(() => new Promise((r) => setTimeout(r, 30)));
}

const input = () => document.querySelector<HTMLInputElement>("input")!;
const saveButton = () =>
	[...document.querySelectorAll("button")].find((b) => b.textContent === "Save");

test("shows the saved limit, and 10 when none is saved", async () => {
	await setup("project_admin", { "settings.workflows.triggerConcurrency": "25" });
	expect(input().value).toBe("25");
	cleanup();
	await setup("project_admin");
	expect(input().value).toBe("10");
});

test("saves a changed limit as a string, only after Save", async () => {
	await setup("project_admin");
	expect(saveButton()).toBeUndefined();
	await act(async () => {
		fireEvent.change(input(), { target: { value: "30" } });
		fireEvent.blur(input());
	});
	await act(async () => void fireEvent.click(saveButton()!));
	await act(() => new Promise((r) => setTimeout(r, 30)));
	expect(upsert).toHaveBeenCalledWith("p1", {
		key: "settings.workflows.triggerConcurrency",
		value: "30",
	});
});

test("a creator can read it but not change it", async () => {
	await setup("creator", { "settings.workflows.triggerConcurrency": "5" });
	expect(input().disabled).toBe(true);
	expect(document.body.textContent).toContain("Only a project admin can change this.");
	expect(saveButton()).toBeUndefined();
});

test("warns that order is no longer strict", async () => {
	await setup("project_admin");
	expect(document.body.textContent).toContain("Set this to 1");
});
