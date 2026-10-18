import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { ExtractCustomBlockModal, nameFromLabel } = await import("./ExtractCustomBlockModal");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function setup() {
	const onSubmit = mock();
	render(
		<ExtractCustomBlockModal
			open
			onOpenChange={() => {}}
			blockCount={3}
			isPending={false}
			onSubmit={onSubmit}
		/>,
	);
	const ui = within(document.body);
	return { onSubmit, ui };
}

test("the name follows the label until it is edited", () => {
	expect(nameFromLabel(" Verify JWT! ")).toBe("verify_jwt");
	const { ui } = setup();
	const [label, name] = ui.getAllByRole("textbox") as HTMLInputElement[];
	fireEvent.change(label, { target: { value: "Verify JWT" } });
	expect(name.value).toBe("verify_jwt");
	fireEvent.change(name, { target: { value: "my_jwt" } });
	fireEvent.change(label, { target: { value: "Verify token" } });
	expect(name.value).toBe("my_jwt");
});

test("Extract stays disabled until there is a label and a valid name", () => {
	const { ui, onSubmit } = setup();
	const button = ui.getByRole("button", { name: "Extract" });
	expect(button.hasAttribute("disabled")).toBe(true);
	const [label, name] = ui.getAllByRole("textbox") as HTMLInputElement[];
	fireEvent.change(label, { target: { value: "Sanitize" } });
	fireEvent.change(name, { target: { value: "Not Valid" } });
	expect(button.hasAttribute("disabled")).toBe(true);
	fireEvent.change(name, { target: { value: "sanitize" } });
	expect(button.hasAttribute("disabled")).toBe(false);
	fireEvent.click(button);
	expect(onSubmit).toHaveBeenCalledWith({ name: "sanitize", label: "Sanitize", replace: false });
});
