import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const updateNodeData = mock();
mock.module("@xyflow/react", () => ({ useReactFlow: () => ({ updateNodeData }) }));
mock.module("../../changes/ChangesContext", () => ({
	useCanvasChanges: () => ({ enabled: true }),
}));

// render's own queries: `screen` stays bound to the document of whichever test file loaded RTL first
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { SingleOrMultiple } = await import("./SingleOrMultiple");

afterEach(() => {
	cleanup();
	updateNodeData.mockClear();
});
afterAll(() => GlobalRegistrator.unregister());

const fields = [
	{ name: "key", label: "Key" },
	{ name: "value", label: "Value" },
];

function setup(data: Record<string, unknown>) {
	const block = { id: "b1", type: "setvar", position: { x: 0, y: 0 }, data };
	return render(
		<SingleOrMultiple block={block} fields={fields} single={<span>single</span>} addLabel="Add" />,
	);
}

test("switching to Multiple turns the current values into the first row", () => {
	const { getByText } = setup({ key: "a", value: "1" });
	fireEvent.click(getByText("Multiple"));
	expect(updateNodeData).toHaveBeenCalledWith("b1", {
		mode: "multiple",
		items: [{ key: "a", value: "1" }],
	});
});

test("switching back with one row keeps it without asking", () => {
	const { getByText } = setup({ mode: "multiple", items: [{ key: "a", value: "1" }] });
	fireEvent.click(getByText("Single"));
	expect(updateNodeData).toHaveBeenCalledWith("b1", { mode: "single", key: "a", value: "1" });
});

test("switching back with more rows asks first, then keeps the first row", () => {
	const { getByText } = setup({
		mode: "multiple",
		items: [
			{ key: "a", value: "1" },
			{ key: "b", value: "2" },
		],
	});
	fireEvent.click(getByText("Single"));
	expect(updateNodeData).not.toHaveBeenCalled();
	// the dialog renders in a portal, outside the rendered container
	fireEvent.click(within(document.body).getByText("Keep first row"));
	expect(updateNodeData).toHaveBeenCalledWith("b1", { mode: "single", key: "a", value: "1" });
});
