import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// the spotlight needs the router; this test is only that the header mounts it
mock.module("@/components/common/ProjectSpotlight", () => ({
	ProjectSpotlight: () => null,
	ProjectSpotlightHost: () => <div data-testid="spotlight" />,
}));

const { cleanup, render } = await import("@testing-library/react");
const { RouteWorkbenchHeader } = await import("./RouteWorkbenchTabs");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

test("the executions header carries the spotlight, like the canvas and project pages", () => {
	const view = render(
		<RouteWorkbenchHeader>
			<span>title</span>
		</RouteWorkbenchHeader>,
	);
	expect(view.getByText("title")).toBeTruthy();
	expect(view.getByTestId("spotlight")).toBeTruthy();
});
