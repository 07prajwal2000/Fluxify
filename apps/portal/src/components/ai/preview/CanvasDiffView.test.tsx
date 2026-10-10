import { afterAll, afterEach, expect, mock, test } from "bun:test";
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

// the real canvas reads the route it sits on
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useParams: () => ({ projectId: "p1" }),
	useMatch: () => undefined,
	useNavigate: () => () => {},
	useRouter: () => ({}),
	Link: ({ to, children, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
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

const show = (d: CanvasDiff) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<CanvasDiffView diff={d} />
		</QueryClientProvider>,
	);

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
	const view = show(diff);
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
	const view = show(diff);
	// the first touched block is open already
	const section = await until(() => view.getByLabelText("response_1 changed"));
	expect(section.querySelector("del")?.textContent).toBe("200");
	expect(section.querySelector("ins")?.textContent).toBe("201");
	expect(section.textContent).toContain("transformScript");
	expect(section.textContent).toContain("-return b;");
	expect(section.textContent).toContain("+return c;");
});

test("clicking a block's chip, or the block itself, shows what happened to it", async () => {
	const view = show(diff);
	fireEvent.click(await until(() => view.getByRole("button", { name: "db_insert_1" })));
	expect(view.getByLabelText("db_insert_1 added").textContent).toContain("users");
	const gone = await until(() => view.container.querySelector('[data-block-key="consolelog_1"]'));
	fireEvent.click(gone as Element);
	await until(() =>
		expect(view.getByLabelText("consolelog_1 removed").textContent).toContain("value"),
	);
});

test("the touched blocks sit in a fold, there is no zoom bar, and the canvas can be expanded", async () => {
	const view = show(diff);
	await until(() =>
		expect(view.container.querySelector('[data-block-key="response_1"]')).not.toBeNull(),
	);
	const fold = view.container.querySelector("details") as HTMLDetailsElement;
	expect(fold.open).toBe(false);
	expect(fold.textContent).toContain("Changed blocks (3)");
	// the canvas's own blocks, tinted by class; unchanged ones are left as they are
	expect(view.container.querySelector(".fx-diff--added .fx-block")).not.toBeNull();
	expect(view.container.querySelector(".fx-diff--same .fx-block")).not.toBeNull();
	expect(view.queryByLabelText("Zoom in")).toBeNull();
	// picking a block on the canvas opens the fold
	fireEvent.click(view.container.querySelector('[data-block-key="db_insert_1"]') as Element);
	await until(() => expect(fold.open).toBe(true));

	fireEvent.click(view.getByRole("button", { name: "Expand canvas" }));
	const dialog = await until(() => within(document.body).getByRole("dialog"));
	await until(() => expect(dialog.querySelector('[data-block-key="consolelog_1"]')).not.toBeNull());
	expect(dialog.textContent).toContain("Double-click a block for its settings");
	// one canvas at a time while it is open
	expect(document.querySelectorAll('[data-block-key="response_1"]')).toHaveLength(1);
});

test("a diff built from ops alone cannot open block settings", async () => {
	const view = show({ ...diff, partial: true });
	fireEvent.click(await until(() => view.getByRole("button", { name: "Expand canvas" })));
	const dialog = await until(() => within(document.body).getByRole("dialog"));
	expect(dialog.textContent).not.toContain("Double-click");
});
