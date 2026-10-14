import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { BlockNode } from "../../types";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// render's own queries: `screen` stays bound to the document of whichever test file loaded RTL first
const { cleanup, render } = await import("@testing-library/react");
// a real provider, not a mocked one: a `mock.module` on @xyflow/react leaks into
// every later file in the run (the change tracker's default keeps fields readonly,
// which is all this visibility check needs).
const { ReactFlowProvider } = await import("@xyflow/react");
const { ArrayOpsGeneralSettings } = await import("./ArrayOpsSettings");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const block = (data: Record<string, unknown>) =>
	({ id: "arrayops-1", type: "arrayops", position: { x: 0, y: 0 }, data }) as BlockNode;

test("Datasource stays visible while Use Param is on", () => {
	const { getByText } = render(
		<ReactFlowProvider>
			<ArrayOpsGeneralSettings block={block({ operation: "push", useParamAsInput: true })} />
		</ReactFlowProvider>,
	);
	expect(getByText("Datasource")).toBeDefined();
	expect(
		getByText(
			"Choose a variable which contains the target array on which operation will be performed",
		),
	).toBeDefined();
});
