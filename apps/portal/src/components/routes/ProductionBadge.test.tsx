import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
try {
	GlobalRegistrator.register();
} catch {}

const { cleanup, render } = await import("@testing-library/react");
const { ProductionBadge, ProductionLegend } = await import("./ProductionBadge");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

test("the badge is a rocket and Prod, with a title that says why", () => {
	const view = render(<ProductionBadge />);
	expect(view.container.textContent).toBe("Prod");
	expect(view.container.querySelector("svg")).toBeTruthy();
	expect(view.container.querySelector("[title]")?.getAttribute("title")).toContain(
		"promoted version",
	);
});

test("the legend shows the same chip and explains it", () => {
	const view = render(<ProductionLegend />);
	expect(view.getByText("Prod")).toBeTruthy();
	expect(view.getByText(/In production/)).toBeTruthy();
});
