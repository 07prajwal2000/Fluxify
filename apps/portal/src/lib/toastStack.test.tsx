import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, render } = await import("@testing-library/react");
const { Providers, toast } = await import("@fluxify/components");

afterEach(() => {
	act(() => toast.clear());
	cleanup();
});
afterAll(() => GlobalRegistrator.unregister());

/** Not RTL's waitFor: it stays bound to the DOM of whichever test file loaded RTL first. */
async function until<T>(check: () => T, timeout = 2000): Promise<T> {
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

// #690: several results at once (a test per environment, a failure and its retry)
// stay side by side and readable, not folded behind the newest one
test("toasts stack expanded once there is more than one", async () => {
	const view = render(<Providers>{null}</Providers>);
	act(() => {
		toast.danger("connect ECONNREFUSED 10.0.0.5:5432");
		toast.success("Connection successful");
	});
	const region = await until(() => {
		const el = document.querySelector('[data-expanded="true"]');
		if (!el) throw new Error("the stack is folded");
		return el;
	});
	expect(region.textContent).toContain("connect ECONNREFUSED 10.0.0.5:5432");
	expect(region.textContent).toContain("Connection successful");
	view.unmount();
});
