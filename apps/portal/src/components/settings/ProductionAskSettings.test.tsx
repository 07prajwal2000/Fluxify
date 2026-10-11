import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ProductionAskSettings } = await import("./ProductionAskSettings");
const { projectSettingsKeysService } = await import("@/services/projectSettingsKeys");
const { authStore } = await import("@/store/auth");

const upsert = spyOn(projectSettingsKeysService, "upsert");

beforeEach(() => upsert.mockReset().mockResolvedValue({} as never));
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function setup(role: "viewer" | "creator", settings: Record<string, string> = {}) {
	authStore
		.getState()
		.actions.setUserData({ id: "u1", name: "U", email: "u@x.io", isSystemAdmin: false });
	authStore.getState().actions.setACL([{ projectId: "p1", role }]);
	render(
		<QueryClientProvider client={new QueryClient()}>
			<ProductionAskSettings projectId="p1" settings={settings} />
		</QueryClientProvider>,
	);
}

const tick = () => act(() => new Promise((r) => setTimeout(r, 30)));
const boxes = () => [...document.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
const alerts = () => [...document.querySelectorAll("[role=alert]")].map((a) => a.textContent);

test("both are on by default and show no warning", () => {
	setup("creator");
	expect(boxes().map((b) => b.checked)).toEqual([true, true]);
	expect(alerts()).toEqual([]);
});

test("turning reads off saves false and the warning shows", async () => {
	setup("creator");
	await act(async () => void fireEvent.click(boxes()[0]));
	await tick();
	expect(upsert).toHaveBeenCalledWith("p1", {
		key: "settings.ai.askBeforeProductionReads",
		value: "false",
	});
});

test("reads saved off: a warning, and the writes one stays hidden", () => {
	setup("creator", { "settings.ai.askBeforeProductionReads": "false" });
	expect(boxes().map((b) => b.checked)).toEqual([false, true]);
	expect(alerts()).toHaveLength(1);
	expect(alerts()[0]).toContain("read production logs");
});

test("writes saved off: the red warning says production can change without asking", () => {
	setup("creator", { "settings.ai.askBeforeProductionWrites": "false" });
	expect(boxes().map((b) => b.checked)).toEqual([true, false]);
	const warning = document.querySelector("[role=alert]")!;
	expect(warning.textContent).toBe(
		"The agent can change production values and triggers without asking.",
	);
	expect(warning.className).toContain("text-danger");
});

test("turning writes back on saves true", async () => {
	setup("creator", { "settings.ai.askBeforeProductionWrites": "false" });
	await act(async () => void fireEvent.click(boxes()[1]));
	await tick();
	expect(upsert).toHaveBeenCalledWith("p1", {
		key: "settings.ai.askBeforeProductionWrites",
		value: "true",
	});
});

test("a viewer can read both but not change them", () => {
	setup("viewer");
	expect(boxes().every((b) => b.disabled)).toBe(true);
	expect(document.body.textContent).toContain("Only a creator can change these.");
});
