import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { TodosButton } = await import("./TodoList");

afterEach(() => {
	cleanup();
	localStorage.clear();
});
afterAll(() => GlobalRegistrator.unregister());

const q = () => within(document.body);
async function until<T>(check: () => T, timeout = 1500): Promise<T> {
	const end = Date.now() + timeout;
	for (;;) {
		try {
			return check();
		} catch (e) {
			if (Date.now() > end) throw e;
			await act(() => new Promise((r) => setTimeout(r, 20)));
		}
	}
}

type Todos = Parameters<typeof TodosButton>[0]["todos"];
const open: Todos = [
	{ id: "1", text: "Build", status: "done" },
	{ id: "2", text: "Test", status: "in_progress" },
];
const finished: Todos = [
	{ id: "1", text: "Build", status: "done" },
	{ id: "2", text: "Test", status: "dropped" },
];
const button = () => q().queryByRole("button", { name: /^Tasks:/ });
async function popover() {
	fireEvent.click(button() as HTMLElement);
	return until(() => q().getByTestId("tasks-header"));
}

test("no close button while tasks are open; the header stays put while the list scrolls", async () => {
	render(<TodosButton todos={open} conversationId="c1" />);
	const header = await popover();
	expect(header.className).toContain("sticky");
	expect(header.className).toContain("top-0");
	expect(q().queryByRole("button", { name: "Close tasks" })).toBeNull();
});

test("a finished list can be closed, stays closed on reload, and a new list brings it back", async () => {
	render(<TodosButton todos={finished} conversationId="c1" />);
	await popover();
	fireEvent.click(await until(() => q().getByRole("button", { name: "Close tasks" })));
	await until(() => expect(button()).toBeNull());

	// a reload of the same conversation keeps it closed
	cleanup();
	render(<TodosButton todos={finished} conversationId="c1" />);
	expect(button()).toBeNull();
	cleanup();
	// another conversation is not affected
	render(<TodosButton todos={finished} conversationId="c2" />);
	expect(button()).not.toBeNull();
	cleanup();

	// a new update_todos changes the list: the button is back
	const again = render(<TodosButton todos={finished} conversationId="c1" />);
	expect(button()).toBeNull();
	again.rerender(
		<TodosButton
			todos={[...finished, { id: "3", text: "Ship", status: "pending" }]}
			conversationId="c1"
		/>,
	);
	expect(button()).not.toBeNull();
});
