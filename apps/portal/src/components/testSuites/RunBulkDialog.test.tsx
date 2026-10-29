import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { RunBulkDialog } = await import("./RunBulkDialog");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const SUITES = [
	{ id: "a", name: "create-user", enabled: true },
	{ id: "b", name: "read-user", enabled: true },
	{ id: "c", name: "delete-all-users", enabled: false },
];

function setup() {
	const onRun = mock();
	render(<RunBulkDialog open suites={SUITES} pending={false} onClose={() => {}} onRun={onRun} />);
	const ui = within(document.body);
	return { onRun, ui };
}

test("enabled suites start ticked, disabled ones are tagged and unticked", () => {
	const { onRun, ui } = setup();
	expect(ui.getByText("disabled")).toBeTruthy();
	expect(ui.queryByText(/including/)).toBeNull();
	fireEvent.click(ui.getByRole("button", { name: "Run 2" }));
	expect(onRun).toHaveBeenCalledWith(["a", "b"]);
});

test("ticking a disabled suite asks for confirmation text and runs it", () => {
	const { onRun, ui } = setup();
	fireEvent.click(ui.getByLabelText("delete-all-users"));
	expect(ui.getByText(/including 1 that is disabled/)).toBeTruthy();
	fireEvent.click(ui.getByRole("button", { name: "Run 3" }));
	expect(onRun).toHaveBeenCalledWith(["a", "b", "c"]);
});
