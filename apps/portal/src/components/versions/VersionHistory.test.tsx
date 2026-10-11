import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
// React Flow measures its nodes with these
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
Element.prototype.scrollIntoView = () => {};

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

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { toast } = await import("@fluxify/components");
const { authStore } = await import("@/store/auth");
const { versionsService } = await import("@/services/versions");
const { routesService } = await import("@/services/routes");
const { middlewaresService } = await import("@/services/middlewares");
const { sandboxesService } = await import("@/services/sandboxes");
const { VersionHistory } = await import("./VersionHistory");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

/** Not RTL's waitFor: it stays bound to the DOM of whichever test file loaded RTL first. */
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

function setRole(role: "viewer" | "creator") {
	authStore.setState((s) => {
		s.state.acl = { p1: role };
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
	});
}

const version = (n: number, extra: object = {}) => ({
	id: `v${n}`,
	kind: "route",
	targetId: "r1",
	versionNumber: n,
	title: `Title ${n}`,
	description: null,
	author: "Ada",
	authorEmail: "ada@x.io",
	createdAt: "2026-10-01T10:00:00.000Z",
	parentId: n > 1 ? `v${n - 1}` : null,
	isHead: false,
	...extra,
});

const detail = (n: number) => ({
	...version(n),
	snapshot: {
		blocks: [
			{ id: `en${n}`, key: "entrypoint_1", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
			{ id: `rs${n}`, key: "response_1", type: "response", data: {}, position: { x: 200, y: 0 } },
		],
		edges: [],
		settings: {
			path: `/orders-v${n}`,
			method: "GET",
			timeoutSeconds: 45,
			querySchema: null,
			bodySchema: null,
			paramsSchema: null,
			middlewares: { before: ["m1"], after: [] },
		},
	},
});

function stub(options: { versions: ReturnType<typeof version>[]; uncommitted?: boolean }) {
	spyOn(versionsService, "list").mockResolvedValue({
		versions: options.versions,
		uncommitted: options.uncommitted ?? false,
	} as never);
	spyOn(versionsService, "get").mockImplementation((async (
		_kind: string,
		_id: string,
		versionId: string,
	) => detail(Number(versionId.slice(1)))) as never);
	spyOn(routesService, "getById").mockResolvedValue({
		id: "r1",
		projectId: "p1",
		name: "Orders",
		method: "GET",
		path: "/orders",
		headVersionNumber: 2,
		uncommitted: false,
	} as never);
	spyOn(middlewaresService, "getAll").mockResolvedValue([
		{ id: "m1", name: "Auth", blocks: [] },
	] as never);
}

function renderHistory() {
	const back = mock(() => undefined);
	const view = render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<VersionHistory
				kind="route"
				id="r1"
				projectId="p1"
				onBackToCanvas={back}
				onOpenSandbox={() => undefined}
			/>
		</QueryClientProvider>,
	);
	return { view, back };
}

const button = (name: string) => {
	const found = [...document.body.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
	);
	if (!found) throw new Error(`no button ${name}`);
	return found;
};

beforeEach(() => setRole("creator"));

test("lists the versions newest first, tags the head, and falls back to the email", async () => {
	stub({
		versions: [
			version(3, { author: null, authorEmail: "gone@x.io" }),
			version(2, { isHead: true }),
			version(1),
		],
	});
	const { view } = renderHistory();
	await until(() => view.getByText("Title 3"));

	const items = [...document.body.querySelectorAll('ul[aria-label="Versions"] > li')];
	expect(items.map((li) => li.textContent?.match(/v\d/)?.[0])).toEqual(["v3", "v2", "v1"]);
	expect(items[1]?.textContent).toContain("Current");
	expect(items[0]?.textContent).not.toContain("Current");
	expect(items[0]?.textContent).toContain("gone@x.io");
	expect(items[1]?.textContent).toContain("Ada");
	// the full time is on hover
	expect(items[1]?.querySelector("time")?.getAttribute("title")).toBeTruthy();
});

test("work no version holds shows as a row that leads back to the canvas", async () => {
	stub({ versions: [version(1, { isHead: true })], uncommitted: true });
	const { view, back } = renderHistory();
	await until(() => view.getByText("Uncommitted changes"));
	fireEvent.click(view.getByText("Uncommitted changes"));
	expect(back).toHaveBeenCalled();
});

test("shows no uncommitted row when the working copy is clean", async () => {
	stub({ versions: [version(1, { isHead: true })] });
	const { view } = renderHistory();
	await until(() => view.getByText("Title 1"));
	expect(view.queryByText("Uncommitted changes")).toBeNull();
});

test("the empty state says to commit", async () => {
	stub({ versions: [] });
	const { view } = renderHistory();
	await until(() => view.getByText("No versions yet. Commit to save the first one."));
});

test("the head opens first, read-only: no Save, and its settings are shown as text", async () => {
	stub({ versions: [version(2, { isHead: true }), version(1)] });
	const { view } = renderHistory();
	await until(() => view.getByText("/orders-v2"));

	// nothing here can be saved
	expect(view.queryByRole("button", { name: "Save" })).toBeNull();
	expect(view.getByText("45 seconds")).toBeTruthy();
	await until(() => view.getByText("Auth"));
	// the settings are text, not fields
	expect(view.getByLabelText("Version settings").querySelector("input, textarea")).toBeNull();
	// the canvas has drawn the version's two blocks
	await until(() => expect(document.body.querySelectorAll(".react-flow__node")).toHaveLength(2));
});

test("the version's canvas is the read-only one: no Save, nothing to drag or undo", async () => {
	stub({ versions: [version(2, { isHead: true })] });
	const { view } = renderHistory();
	await until(() => expect(document.body.querySelectorAll(".react-flow__node")).toHaveLength(2));

	expect(document.body.querySelector(".fx-canvas--readonly")).not.toBeNull();
	// blocks cannot be dragged, and the edit-only controls are absent
	expect(document.body.querySelector(".react-flow__node.draggable")).toBeNull();
	expect(view.queryByRole("button", { name: "Save" })).toBeNull();
	expect((view.getByRole("button", { name: "Undo" }) as HTMLButtonElement).disabled).toBe(true);
});

test("choosing another version shows that version", async () => {
	stub({ versions: [version(2, { isHead: true }), version(1)] });
	const { view } = renderHistory();
	await until(() => view.getByText("/orders-v2"));
	fireEvent.click(view.getByText("Title 1"));
	await until(() => view.getByText("/orders-v1"));
	expect(view.queryByText("/orders-v2")).toBeNull();
});

test("Copy version id writes the id to the clipboard", async () => {
	stub({ versions: [version(2, { isHead: true })] });
	const writeText = mock(async (_text: string) => undefined);
	Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
	const success = spyOn(toast, "success").mockImplementation((() => "") as never);
	const { view } = renderHistory();
	await until(() => view.getByText("Title 2"));

	fireEvent.click(button("v2 options"));
	fireEvent.click(await until(() => view.getByRole("menuitem", { name: "Copy version id" })));

	await until(() => expect(writeText).toHaveBeenCalledWith("v2"));
	await until(() => expect(success).toHaveBeenCalledWith("Version id copied"));
});

test("a viewer reads the history but is offered neither Check out nor Open in sandbox", async () => {
	setRole("viewer");
	stub({ versions: [version(2, { isHead: true })] });
	const { view } = renderHistory();
	await until(() => view.getByText("Title 2"));

	fireEvent.click(button("v2 options"));
	await until(() => view.getByRole("menuitem", { name: "Copy version id" }));
	expect(view.queryByRole("menuitem", { name: "Check out" })).toBeNull();
	expect(view.queryByRole("menuitem", { name: "Open in sandbox" })).toBeNull();
});

test("Open in sandbox copies the chosen version's blocks, not the live canvas", async () => {
	stub({ versions: [version(2, { isHead: true }), version(1)] });
	const live = spyOn(routesService, "getCanvasItems");
	spyOn(sandboxesService, "create").mockResolvedValue({ id: "sb9" } as never);
	spyOn(sandboxesService, "getCanvasItems").mockResolvedValue({
		canvasRevision: 1,
		blocks: [
			{ id: "sen", key: "entrypoint_1", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
			{
				id: "seh",
				key: "error_handler_1",
				type: "error_handler",
				data: {},
				position: { x: 0, y: 99 },
			},
		],
		edges: [],
	} as never);
	const put = spyOn(sandboxesService, "saveCanvas").mockResolvedValue({} as never);
	const opened = mock((_id: string) => undefined);
	const view = render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<VersionHistory
				kind="route"
				id="r1"
				projectId="p1"
				onBackToCanvas={() => undefined}
				onOpenSandbox={opened}
			/>
		</QueryClientProvider>,
	);
	await until(() => view.getByText("Title 1"));

	fireEvent.click(button("v1 options"));
	fireEvent.click(await until(() => view.getByRole("menuitem", { name: "Open in sandbox" })));
	// the dialog says what a route's sandbox copy leaves behind, from the version's own settings
	await until(() => button("Create sandbox"));
	expect(document.body.textContent).toContain("middlewares are not copied");
	fireEvent.click(button("Create sandbox"));

	await until(() => expect(opened).toHaveBeenCalledWith("sb9"));
	expect(sandboxesService.create).toHaveBeenCalledWith("p1", { name: "Orders v1 sandbox" });
	expect(live).not.toHaveBeenCalled();
	const payload = (put.mock.calls[0] as unknown[])[2] as {
		changes: { blocks: { type: string }[] };
	};
	// the version's response block comes across; the sandbox keeps its own entrypoint
	expect(payload.changes.blocks.map((b) => b.type)).toEqual(["response"]);
});
