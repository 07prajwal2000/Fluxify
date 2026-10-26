import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
try {
	GlobalRegistrator.register();
} catch {}

const { cleanup, render } = await import("@testing-library/react");
const { MethodPill, ProductionLegend } = await import("./MethodPill");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

test("a route in production shows a rocket and P before its method, with a title that says why", () => {
	const view = render(<MethodPill method="GET" inProduction />);
	const mark = view.getByLabelText("In production");
	expect(mark.textContent).toBe("P");
	expect(mark.querySelector("svg")).toBeTruthy();
	expect(view.container.textContent).toBe("PGET");
	expect(view.container.querySelector("[title]")?.getAttribute("title")).toContain(
		"promoted version",
	);
});

test("the mark comes before the recording dots and the method", () => {
	const view = render(
		<MethodPill method="GET" inProduction>
			<span data-testid="dots" />
		</MethodPill>,
	);
	const mark = view.getByLabelText("In production");
	const dots = view.getByTestId("dots");
	expect(mark.compareDocumentPosition(dots) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("a route that is not in production keeps the plain method", () => {
	const view = render(<MethodPill method="POST" inProduction={false} />);
	expect(view.queryByLabelText("In production")).toBeNull();
	expect(view.container.textContent).toBe("POST");
	expect(view.container.querySelector("[title]")).toBeNull();
});

test("the legend explains the P", () => {
	const view = render(<ProductionLegend />);
	expect(view.getByText(/In production/)).toBeTruthy();
	expect(view.getByLabelText("In production").querySelector("svg")).toBeTruthy();
});
