import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
Element.prototype.scrollIntoView = () => {};

const customDefs = [
	{ id: "1", name: "myBlock", label: "My Block", usage: "flow" as const },
	{ id: "2", name: "selfBlock", label: "Self Block", usage: "flow" as const, isSelf: true },
];
mock.module("./blocks/useCustomBlockDefs", () => ({
	useCustomBlockDefs: () => customDefs,
	useAddableCustomBlockDefs: () => customDefs,
}));

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { BlockPickerSidebar } = await import("./BlockPickerSidebar");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function setup() {
	const onAdd = mock();
	const onOpenChange = mock();
	render(<BlockPickerSidebar isOpen onOpenChange={onOpenChange} onAdd={onAdd} />);
	const input = within(document.body).getByRole("combobox");
	const press = (key: string) => fireEvent.keyDown(input, { key });
	const active = () => {
		const id = input.getAttribute("aria-activedescendant");
		return id ? document.getElementById(id)?.textContent : undefined;
	};
	const type = (value: string) => fireEvent.change(input, { target: { value } });
	return { onAdd, onOpenChange, press, active, type };
}

test("arrows move the highlight through categories and wrap", () => {
	const { press, active } = setup();
	expect(active()).toStartWith("Core");
	press("ArrowDown");
	expect(active()).toStartWith("Flow");
	press("ArrowUp");
	press("ArrowUp");
	expect(active()).toStartWith("Custom");
	press("ArrowDown");
	expect(active()).toStartWith("Core");
});

test("Enter opens a category and adds a block, then closes", () => {
	const { press, active, onAdd, onOpenChange } = setup();
	press("ArrowUp");
	press("Enter");
	expect(active()).toStartWith("My Block");
	press("Enter");
	expect(onAdd).toHaveBeenCalledWith("myBlock");
	expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("a disabled block can be highlighted but Enter does nothing", () => {
	const { press, active, onAdd } = setup();
	press("ArrowUp");
	press("Enter");
	press("ArrowDown");
	expect(active()).toStartWith("Self Block");
	press("Enter");
	expect(onAdd).not.toHaveBeenCalled();
});

test("ArrowLeft, Backspace and Esc go back; Esc on categories closes", () => {
	const { press, active, onOpenChange } = setup();
	for (const key of ["ArrowLeft", "Backspace", "Escape"]) {
		press("Enter");
		expect(active()).toStartWith("Response");
		press(key);
		expect(active()).toStartWith("Core");
	}
	expect(onOpenChange).not.toHaveBeenCalled();
	press("Escape");
	expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("typing resets the highlight to the first hit, Enter adds it", () => {
	const { press, active, type, onAdd } = setup();
	press("ArrowDown");
	type("my block");
	expect(active()).toStartWith("My Block");
	press("Enter");
	expect(onAdd).toHaveBeenCalledWith("myBlock");
});

test("hovering a row moves the highlight", () => {
	const { active } = setup();
	fireEvent.mouseEnter(within(document.body).getByRole("option", { name: /^Flow/ }));
	expect(active()).toStartWith("Flow");
});
