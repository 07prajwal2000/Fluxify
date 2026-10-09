import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { CanvasDiff } from "./canvasDiff";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
// ReactFlow measures its nodes with these
class Observer {
	observe() {}
	unobserve() {}
	disconnect() {}
}
Object.assign(globalThis, { ResizeObserver: Observer });
Object.assign(globalThis, {
	DOMMatrixReadOnly: class {
		m22 = 1;
		constructor() {}
	},
});

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { CanvasDiffView } = await import("./CanvasDiffView");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const at = (x: number) => ({ x, y: 0 });
const diff: CanvasDiff = {
	blocks: [
		{
			key: "entrypoint_1",
			type: "entrypoint",
			status: "same",
			position: at(0),
			data: {},
			changes: [],
		},
		{
			key: "response_1",
			type: "response",
			status: "changed",
			position: at(250),
			data: {},
			changes: [
				{ field: "httpCode", before: "200", after: "201" },
				{ field: "transformScript", before: "return a;\nreturn b;", after: "return a;\nreturn c;" },
			],
		},
		{
			key: "db_insert_1",
			type: "db_insert",
			status: "added",
			position: at(500),
			data: { table: "users" },
			changes: [{ field: "table", after: "users" }],
		},
		{
			key: "consolelog_1",
			type: "consolelog",
			status: "removed",
			position: at(750),
			data: { value: "a" },
			changes: [{ field: "value", before: "a" }],
		},
	],
	edges: [
		{ id: "1", from: "entrypoint_1", to: "response_1", handle: "source", status: "same" },
		{ id: "2", from: "response_1", to: "db_insert_1", handle: "source", status: "added" },
		{ id: "3", from: "response_1", to: "consolelog_1", handle: "failure", status: "removed" },
	],
};

/** Not RTL's waitFor/screen: they stay bound to the DOM of whichever test file loaded RTL first. */
async function until<T>(check: () => T, timeout = 2000): Promise<T> {
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

test("added, changed and removed blocks are told apart on the mini canvas, by key", async () => {
	const view = render(<CanvasDiffView diff={diff} />);
	const node = (key: string) => view.container.querySelector(`[data-block-key="${key}"]`);
	await until(() => expect(node("response_1")).not.toBeNull());
	expect(node("entrypoint_1")?.getAttribute("data-status")).toBe("same");
	expect(node("response_1")?.getAttribute("data-status")).toBe("changed");
	expect(node("db_insert_1")?.getAttribute("data-status")).toBe("added");
	expect(node("consolelog_1")?.getAttribute("data-status")).toBe("removed");
	expect(view.getByLabelText("Legend").textContent).toContain("1 added");
	expect(view.getByLabelText("Legend").textContent).toContain("1 changed");
	expect(view.getByLabelText("Legend").textContent).toContain("1 removed");
});

test("a changed block opens on its field-level before and after, code as a text diff", async () => {
	const view = render(<CanvasDiffView diff={diff} />);
	// the first touched block is open already
	const section = await until(() => view.getByLabelText("response_1 changed"));
	expect(section.querySelector("del")?.textContent).toBe("200");
	expect(section.querySelector("ins")?.textContent).toBe("201");
	expect(section.textContent).toContain("transformScript");
	expect(section.textContent).toContain("-return b;");
	expect(section.textContent).toContain("+return c;");
});

test("clicking a block's chip, or the block itself, shows what happened to it", async () => {
	const view = render(<CanvasDiffView diff={diff} />);
	fireEvent.click(await until(() => view.getByRole("button", { name: "db_insert_1" })));
	expect(view.getByLabelText("db_insert_1 added").textContent).toContain("users");
	const gone = await until(() => view.container.querySelector('[data-block-key="consolelog_1"]'));
	fireEvent.click(gone as Element);
	await until(() =>
		expect(view.getByLabelText("consolelog_1 removed").textContent).toContain("value"),
	);
});
