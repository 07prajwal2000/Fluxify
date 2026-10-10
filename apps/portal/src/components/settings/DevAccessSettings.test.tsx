import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { DevAccessSettings } = await import("./DevAccessSettings");
const { projectDevTokenService } = await import("@/services/projectDevToken");
const { authStore } = await import("@/store/auth");

const TOKEN = "fxd_test_token_value_that_must_not_be_rendered";
const ROTATED = "fxd_rotated_token_value";

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

const get = spyOn(projectDevTokenService, "get");
const rotate = spyOn(projectDevTokenService, "rotate");
let copied: string[] = [];

beforeEach(() => {
	copied = [];
	get.mockReset().mockResolvedValue({ token: TOKEN });
	rotate.mockReset().mockResolvedValue({ token: ROTATED });
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText: async (text: string) => void copied.push(text) },
	});
});
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function setup(role: "viewer" | "creator" | "project_admin") {
	authStore
		.getState()
		.actions.setUserData({ id: "u1", name: "U", email: "u@x.io", isSystemAdmin: false });
	authStore.getState().actions.setACL([{ projectId: "p1", role }]);
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<DevAccessSettings projectId="p1" />
		</QueryClientProvider>,
	);
}

const button = (name: string, root: ParentNode = document) =>
	[...root.querySelectorAll("button")].find((b) => b.textContent?.includes(name));

test("a viewer sees nothing and the token is never fetched", async () => {
	setup("viewer");
	await act(() => new Promise((r) => setTimeout(r, 50)));
	expect(document.body.textContent).not.toContain("Development access");
	expect(get).not.toHaveBeenCalled();
});

test("a creator can copy the token but not rotate it", async () => {
	setup("creator");
	await until(() => {
		expect(get).toHaveBeenCalledWith("p1");
		expect(button("Copy token")?.hasAttribute("disabled")).toBe(false);
	});
	expect(button("Rotate token")).toBeUndefined();

	fireEvent.click(button("Copy token")!);
	await until(() => expect(copied).toEqual([TOKEN]));
	// masked on screen: the secret only ever reaches the clipboard
	expect(document.body.textContent).not.toContain(TOKEN);
});

test("an admin can copy, and rotating asks first, then calls the API", async () => {
	setup("project_admin");
	await until(() => expect(button("Copy token")?.hasAttribute("disabled")).toBe(false));

	fireEvent.click(button("Rotate token")!);
	const dialog = await until(() => {
		const d = document.querySelector('[role="dialog"]');
		if (!d) throw new Error("no dialog");
		return d;
	});
	expect(dialog.textContent).toContain("stops working");
	expect(rotate).not.toHaveBeenCalled();

	fireEvent.click(button("Rotate token", dialog)!);
	await until(() => expect(rotate).toHaveBeenCalledWith("p1"));

	// the new token is the one the copy button hands out
	await until(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
	fireEvent.click(button("Copy token")!);
	await until(() => expect(copied).toEqual([ROTATED]));
});
