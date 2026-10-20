import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { PluginsSettings } = await import("./PluginsSettings");
const { pluginsService } = await import("@/services/plugins");
const { authStore } = await import("@/store/auth");
const { plugin, upgrading } = await import("./fixtures");

const list = spyOn(pluginsService, "list");
const setEnvironments = spyOn(pluginsService, "setEnvironments");

async function until<T>(check: () => T, timeout = 1500): Promise<T> {
	const end = Date.now() + timeout;
	for (;;) {
		try {
			return check();
		} catch (e) {
			if (Date.now() > end) throw e;
			await act(() => new Promise((r) => setTimeout(r, 20)));
		}
	}
}

beforeEach(() => {
	list.mockReset().mockResolvedValue([plugin(), plugin({ id: "pl2", name: "acme/mail" })]);
	setEnvironments.mockReset().mockResolvedValue(plugin());
});
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function setup(role: "viewer" | "creator") {
	authStore
		.getState()
		.actions.setUserData({ id: "u1", name: "U", email: "u@x.io", isSystemAdmin: false });
	authStore.getState().actions.setACL([{ projectId: "p1", role }]);
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<PluginsSettings projectId="p1" />
		</QueryClientProvider>,
	);
}

test("lists each plugin with its version, source and approval", async () => {
	setup("creator");
	await until(() => expect(document.body.textContent).toContain("acme/slack"));
	expect(document.body.textContent).toContain("acme/mail");
	expect(document.body.textContent).toContain("1.0.0");
	expect(document.body.textContent).toContain("npm");
	expect(document.body.textContent).toContain("Approved");
});

test("an upgrade shows the live version and the pending one", async () => {
	list.mockResolvedValue([upgrading()]);
	setup("creator");
	await until(() => expect(document.body.textContent).toContain("1.0.0 → 1.1.0"));
	expect(document.body.textContent).toContain("Upgrade pending");
});

test("a creator's env checkbox calls the service with both environments", async () => {
	setup("creator");
	const prod = await until(() => {
		const box = document.querySelector<HTMLInputElement>(
			'input[aria-label="Enable acme/slack in production"]',
		);
		if (!box) throw new Error("no checkbox yet");
		return box;
	});
	await act(async () => void fireEvent.click(prod));
	await until(() =>
		expect(setEnvironments).toHaveBeenCalledWith("p1", "acme/slack", { dev: true, prod: true }),
	);
});

test("a viewer reads the list but cannot switch environments or add", async () => {
	setup("viewer");
	await until(() => expect(document.body.textContent).toContain("acme/slack"));
	const box = document.querySelector<HTMLInputElement>(
		'input[aria-label="Enable acme/slack in production"]',
	);
	expect(box?.disabled).toBe(true);
	expect(document.body.textContent).not.toContain("Add plugin");
});
