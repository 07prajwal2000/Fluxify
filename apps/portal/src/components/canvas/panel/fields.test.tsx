import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { ReactFlowProvider, useNodes, useReactFlow } = await import("@xyflow/react");
const { CanvasChangesProvider, DISABLED_CHANGES } = await import("../changes/ChangesContext");
const { BlockJsTextField } = await import("./fields");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

let update: (data: Record<string, unknown>) => void;
/** Feeds the field the node's stored data, as the settings panel does. */
function Field() {
	const data = useNodes()[0].data;
	const { updateNodeData } = useReactFlow();
	update = (next) => updateNodeData("b1", next);
	return <BlockJsTextField blockId="b1" data={data} name="text" label="Text" />;
}

function setup(initial: Record<string, unknown>) {
	let stored: unknown;
	function Probe() {
		stored = useNodes()[0].data.text;
		return null;
	}
	render(
		<ReactFlowProvider defaultNodes={[{ id: "b1", position: { x: 0, y: 0 }, data: initial }]}>
			<CanvasChangesProvider value={{ ...DISABLED_CHANGES, enabled: true }}>
				<Field />
			</CanvasChangesProvider>
			<Probe />
		</ReactFlowProvider>,
	);
	const input = within(document.body).getByLabelText("Text") as HTMLInputElement;
	return { input, stored: () => stored };
}

test("an edit in the middle keeps the caret where the user put it", () => {
	const { input } = setup({ text: "hello world" });
	input.focus();
	input.setSelectionRange(6, 6);
	// what the browser does: new value, caret just after the typed character
	fireEvent.change(input, {
		target: { value: "hello Xworld", selectionStart: 7, selectionEnd: 7 },
	});
	expect(input.value).toBe("hello Xworld");
	expect(input.selectionStart).toBe(7);
});

test("text that looks like a number is not rewritten while typing", () => {
	const { input, stored } = setup({ text: "" });
	for (const typed of ["0", "01", "1.", "1 "]) {
		fireEvent.change(input, { target: { value: typed } });
		expect(input.value).toBe(typed);
	}
	fireEvent.change(input, { target: { value: "01" } });
	expect(stored()).toBe(1);
});

test("an outside change to the stored value shows up", () => {
	const { input } = setup({ text: "a" });
	act(() => update({ text: "from the AI" }));
	expect(input.value).toBe("from the AI");
});
