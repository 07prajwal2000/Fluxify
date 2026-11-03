import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
try {
	GlobalRegistrator.register();
} catch {}

const { cleanup, render } = await import("@testing-library/react");
const { EnvStatusChips } = await import("./EnvStatusChips");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

test("each environment gets a chip that says whether it is enabled", () => {
	const view = render(<EnvStatusChips prod={false} dev />);
	expect(view.getByLabelText("Production: disabled").textContent).toBe("Prod");
	expect(view.getByLabelText("Development: enabled").textContent).toBe("Dev");
});

test("production switched on with nothing promoted says so", () => {
	const view = render(<EnvStatusChips prod dev={false} promoted={false} />);
	expect(view.getByLabelText("Production: enabled, but no version is promoted yet")).toBeTruthy();
	expect(view.getByLabelText("Development: disabled")).toBeTruthy();
});

test("production with a promoted version is plainly enabled", () => {
	const view = render(<EnvStatusChips prod dev promoted />);
	expect(view.getByLabelText("Production: enabled")).toBeTruthy();
	// the explanation is the tooltip's, not the browser's title attribute
	expect(view.container.querySelector("[title]")).toBeNull();
});
