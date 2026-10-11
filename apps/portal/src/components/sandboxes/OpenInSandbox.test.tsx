import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const opened = mock((_sandboxId: string) => undefined);

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
/** Not RTL's waitFor/screen: they stay bound to the DOM of whichever test file loaded RTL first. */
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
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { authStore } = await import("@/store/auth");
const { sandboxesService } = await import("@/services/sandboxes");
const { routesService } = await import("@/services/routes");
const { workflowsService } = await import("@/services/workflows");
const { middlewaresService } = await import("@/services/middlewares");
const { OpenInSandboxButton } = await import("./OpenInSandboxButton");

afterEach(() => {
	cleanup();
	mock.restore();
	opened.mockClear();
});
afterAll(() => GlobalRegistrator.unregister());

const block = (id: string, type: string, data: object = {}, x = 0) => ({
	id,
	key: `${type}_1`,
	type,
	data,
	position: { x, y: 0 },
});
const edge = (id: string, from: string, to: string, handle = "source") => ({
	id,
	from,
	to,
	fromHandle: `${from}-${handle}`,
	toHandle: `${to}-target`,
});

/** entrypoint → jsrunner → response, with an error handler */
const SOURCE = {
	canvasVersion: 3,
	blocks: [
		block("en", "entrypoint"),
		block("eh", "error_handler"),
		block("js", "jsrunner", { value: "return 1", blockName: "one" }, 100),
		block("rs", "response", { httpCode: 200 }, 200),
	],
	edges: [edge("e1", "en", "js"), edge("e2", "js", "rs")],
};
const OWN = {
	canvasVersion: 1,
	blocks: [block("sen", "entrypoint"), block("seh", "error_handler")],
	edges: [],
};

const route = (extra: object = {}) => ({
	id: "r1",
	name: "Orders",
	method: "get",
	path: "/orders",
	projectId: "p1",
	bodySchema: undefined,
	querySchema: undefined,
	paramsSchema: undefined,
	...extra,
});

function setRole(role: "viewer" | "creator") {
	authStore.setState((s) => {
		s.state.acl = { p1: role };
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
	});
}

function stubServer(options: { record?: object; middlewares?: boolean } = {}) {
	spyOn(routesService, "getById").mockResolvedValue(route(options.record) as never);
	spyOn(middlewaresService, "getForRoute").mockResolvedValue({
		before: options.middlewares ? [{ id: "m1", name: "auth" }] : [],
		after: [],
	} as never);
	spyOn(routesService, "getCanvasItems").mockResolvedValue(SOURCE as never);
	spyOn(workflowsService, "getCanvasItems").mockResolvedValue(SOURCE as never);
	const create = spyOn(sandboxesService, "create").mockResolvedValue({ id: "sb9" });
	const remove = spyOn(sandboxesService, "delete").mockResolvedValue(undefined);
	spyOn(sandboxesService, "getCanvasItems").mockResolvedValue(OWN as never);
	const put = spyOn(sandboxesService, "saveCanvas").mockResolvedValue({ canvasVersion: 2 });
	return { create, remove, put };
}

function renderButton(kind: "route" | "workflow") {
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<OpenInSandboxButton
				projectId="p1"
				source={{ kind, id: kind === "route" ? "r1" : "w1", name: "Orders" }}
				onOpen={opened}
			/>
		</QueryClientProvider>,
	);
}

const button = (name: string) => {
	const found = [...document.body.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === name,
	);
	if (!found) throw new Error(`no button ${name}`);
	return found;
};

/** the route and middleware reads settle, so a click sees the warnings */
const settle = () => act(() => new Promise((r) => setTimeout(r, 60)));

beforeEach(() => setRole("creator"));

test("a route with middlewares and a body schema asks first, listing what is not copied", async () => {
	const { create, put } = stubServer({
		middlewares: true,
		record: { bodySchema: { properties: [{ key: "id" }] } },
	});
	renderButton("route");
	await until(() => button("Open in sandbox"));
	await settle();
	fireEvent.click(button("Open in sandbox"));
	await until(() => button("Create sandbox"));

	const text = document.body.textContent ?? "";
	expect(text).toContain("middlewares are not copied");
	expect(text).toContain("request schemas (body, query, params) are not copied");
	expect(create).not.toHaveBeenCalled();
	expect(put).not.toHaveBeenCalled();

	fireEvent.click(button("Create sandbox"));
	await until(() => expect(opened).toHaveBeenCalled());

	expect(create).toHaveBeenCalledWith("p1", { name: "Orders sandbox" });
	const [project, sandbox, payload] = put.mock.calls[0] as [string, string, any];
	expect([project, sandbox]).toEqual(["p1", "sb9"]);
	// two blocks come across with new ids; the sandbox keeps its own entrypoint and error handler
	const copied = payload.changes.blocks;
	expect(copied.map((b: any) => b.type).sort()).toEqual(["jsrunner", "response"]);
	expect(copied.some((b: any) => ["js", "rs", "en", "eh"].includes(b.id))).toBe(false);
	expect(copied.find((b: any) => b.type === "jsrunner").data).toEqual({
		value: "return 1",
		blockName: "one",
	});
	const js = copied.find((b: any) => b.type === "jsrunner").id;
	const rs = copied.find((b: any) => b.type === "response").id;
	const edges = payload.changes.edges;
	expect(edges).toHaveLength(2);
	const fromEntry = edges.find((e: any) => e.from === "sen");
	expect(fromEntry).toMatchObject({ to: js, fromHandle: "sen-source", toHandle: `${js}-target` });
	expect(edges.find((e: any) => e.from === js)).toMatchObject({
		to: rs,
		fromHandle: `${js}-source`,
	});
	expect(payload.actionsToPerform.blocks).toHaveLength(2);
	expect(opened).toHaveBeenCalledWith("sb9");
});

test("a click only asks: nothing is created until the dialog is confirmed", async () => {
	const { create } = stubServer();
	renderButton("route");
	await until(() => button("Open in sandbox"));
	await settle();
	fireEvent.click(button("Open in sandbox"));
	await until(() => button("Create sandbox"));
	expect(document.body.textContent).not.toContain("do not come along");
	expect(create).not.toHaveBeenCalled();
	expect(opened).not.toHaveBeenCalled();

	fireEvent.click(button("Create sandbox"));
	await until(() => expect(opened).toHaveBeenCalled());
	expect(create).toHaveBeenCalledWith("p1", { name: "Orders sandbox" });
});

test("a workflow copies the same way and never warns", async () => {
	const { create, put } = stubServer();
	renderButton("workflow");
	await until(() => button("Open in sandbox"));
	fireEvent.click(button("Open in sandbox"));
	await until(() => button("Create sandbox"));
	fireEvent.click(button("Create sandbox"));
	await until(() => expect(opened).toHaveBeenCalled());
	expect(create).toHaveBeenCalledWith("p1", { name: "Orders sandbox" });
	expect(put).toHaveBeenCalledTimes(1);
});

test("a refused save removes the sandbox it made and does not navigate", async () => {
	const { remove, put } = stubServer();
	put.mockRejectedValue(new Error("refused"));
	renderButton("workflow");
	await until(() => button("Open in sandbox"));
	fireEvent.click(button("Open in sandbox"));
	await until(() => button("Create sandbox"));
	fireEvent.click(button("Create sandbox"));
	await until(() => expect(remove).toHaveBeenCalledWith("p1", "sb9"));
	expect(opened).not.toHaveBeenCalled();
});

test("a viewer has no Open in sandbox", async () => {
	setRole("viewer");
	stubServer();
	renderButton("route");
	await settle();
	expect(document.body.textContent).not.toContain("Open in sandbox");
});
