import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { ReactFlowProvider, useReactFlow } = await import("@xyflow/react");
const { CanvasChangesProvider, DISABLED_CHANGES } = await import("../changes/ChangesContext");
const { BlockDescriptionField, BlockNameInput } = await import("./BlockIdentityFields");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

let saved: Record<string, unknown> | undefined;
/** Reads the node back out of the real store, so no module is mocked. */
function Probe() {
	const { getNode } = useReactFlow();
	saved = getNode("b1")?.data;
	return <button type="button" onClick={() => (saved = getNode("b1")?.data)} data-testid="probe" />;
}

function view(field: React.ReactNode, enabled = true) {
	saved = undefined;
	render(
		<ReactFlowProvider defaultNodes={[{ id: "b1", position: { x: 0, y: 0 }, data: {} }]}>
			<CanvasChangesProvider value={{ ...DISABLED_CHANGES, enabled }}>
				{field}
			</CanvasChangesProvider>
			<Probe />
		</ReactFlowProvider>,
	);
	return () => {
		fireEvent.click(within(document.body).getByTestId("probe"));
		return saved;
	};
}

test("the name is saved on blur, not while typing", () => {
	const read = view(<BlockNameInput blockId="b1" data={{}} placeholder="If" />);
	const input = within(document.body).getByLabelText("Block name");
	fireEvent.change(input, { target: { value: "Check age" } });
	expect(read()?.blockName).toBeUndefined();
	fireEvent.blur(input);
	expect(read()?.blockName).toBe("Check age");
});

test("the description saves on blur", () => {
	const read = view(<BlockDescriptionField blockId="b1" data={{}} placeholder="" />);
	const area = within(document.body).getByLabelText("Block description");
	fireEvent.change(area, { target: { value: "new" } });
	fireEvent.blur(area);
	expect(read()?.blockDescription).toBe("new");
});

test("a read-only canvas shows the fields but locks them", () => {
	view(<BlockNameInput blockId="b1" data={{}} placeholder="If" />, false);
	expect(within(document.body).getByLabelText("Block name").hasAttribute("readonly")).toBe(true);
});
