import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
Element.prototype.scrollIntoView = () => {};
class Observer {
	observe() {}
	unobserve() {}
	disconnect() {}
}
Object.assign(globalThis, { ResizeObserver: Observer });

// a settings panel test has no router: `useParams` gives the project, `Link` a plain anchor
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useParams: () => ({ projectId: "p1" }),
	Link: ({ children, to, search }: { children: unknown; to: string; search?: object }) => (
		<a href={to} data-to={to} data-search={JSON.stringify(search)}>
			{children as never}
		</a>
	),
}));

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ReactFlowProvider } = await import("@xyflow/react");
const { CanvasChangesProvider, DISABLED_CHANGES } = await import("../changes/ChangesContext");
const { PluginBlocksContext } = await import("../plugins/PluginBlocksContext");
const { blocksOf, slack } = await import("../plugins/fixtures");
const { integrationService } = await import("@/services/integrations");
const { PluginBlockSettings } = await import("./blocks/PluginBlockSettings");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

const TYPE = "acme/slack/streams/read";
const row = (id: string, variant: string) => ({
	id,
	name: `cache-${variant}`,
	group: "kv",
	variant,
	config: {},
});
const list = (...rows: ReturnType<typeof row>[]) =>
	spyOn(integrationService, "getAll").mockResolvedValue(rows as never);

function setup(
	data: Record<string, unknown> = {},
	kind = "kv",
	variants: string[] | undefined = ["Redis"],
) {
	const entry = {
		name: TYPE,
		label: "Read stream",
		shape: "square",
		invoke: ["sync"],
		permissions: { integrations: ["kv"] },
		params: { store: { type: "integration", kind, label: "Store", ...(variants && { variants }) } },
		handles: { in: ["target"], out: ["success", "failure"], body: [] },
		deprecated: null,
	};
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const block = { id: "b1", type: TYPE, position: { x: 0, y: 0 }, data } as never;
	return render(
		<QueryClientProvider client={client}>
			<PluginBlocksContext.Provider value={blocksOf(slack([entry]))}>
				<CanvasChangesProvider value={{ ...DISABLED_CHANGES, enabled: true }}>
					<ReactFlowProvider
						defaultNodes={[{ id: "b1", type: TYPE, position: { x: 0, y: 0 }, data }]}
					>
						<PluginBlockSettings block={block} />
					</ReactFlowProvider>
				</CanvasChangesProvider>
			</PluginBlocksContext.Provider>
		</QueryClientProvider>,
	);
}

/**
 * Lets the list load and render, inside `act`: an earlier test file can leave React's
 * scheduler on its closed window, so an update outside `act` would never run.
 */
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));
const choose = async (view: { getByRole: ReturnType<typeof render>["getByRole"] }) => {
	await settle();
	fireEvent.click(view.getByRole("button", { name: "Choose" }));
	await settle();
};

test("the picker offers only the param's variants, from its group", async () => {
	const getAll = list(row("r1", "Redis"), row("m1", "Memcached"));
	const view = setup();
	await choose(view);
	await settle();
	expect(view.getByText("cache-Redis")).toBeDefined();
	expect(view.queryByText("cache-Memcached")).toBeNull();
	expect(getAll).toHaveBeenCalledWith("p1", "kv");
});

test("a kind naming its variant filters the same way", async () => {
	const getAll = list(row("r1", "Redis"), row("m1", "Memcached"));
	const view = setup({}, "kv/Redis", undefined);
	await choose(view);
	await settle();
	expect(view.getByText("cache-Redis")).toBeDefined();
	expect(view.queryByText("cache-Memcached")).toBeNull();
	expect(getAll).toHaveBeenCalledWith("p1", "kv");
});

test("with none of its variants, the empty state names them and links to a new one", async () => {
	list(row("m1", "Memcached"));
	const view = setup();
	await choose(view);
	await settle();
	expect(view.getByText("No Redis integration yet")).toBeDefined();
	const link = view.getByText("Create a Redis integration").closest("a")!;
	expect(link.getAttribute("data-to")).toBe("/$projectId/integrations/new");
	expect(JSON.parse(link.getAttribute("data-search")!)).toEqual({ group: "kv", variant: "Redis" });
});

test("a saved integration of a variant it no longer takes shows an error and stays saved", async () => {
	list(row("r1", "Redis"), row("m1", "Memcached"));
	const view = setup({ store: "m1" });
	await settle();
	expect(view.getByRole("alert").textContent).toBe(
		'"cache-Memcached" is Memcached; this field takes only Redis',
	);
	expect(view.getByText("None selected")).toBeDefined();
});

test("a saved integration it takes shows no error", async () => {
	list(row("r1", "Redis"));
	const view = setup({ store: "r1" });
	await settle();
	expect(view.getByText("cache-Redis")).toBeDefined();
	expect(view.queryByRole("alert")).toBeNull();
});

test("the trigger wizard's renderer filters and flags the same way", async () => {
	const { PluginParamFields } = await import("@/components/integrations/PluginIntegrationForm");
	list(row("r1", "Redis"), row("m1", "Memcached"));
	const view = render(
		<QueryClientProvider client={new QueryClient()}>
			<PluginParamFields
				projectId="p1"
				variant="plugin:acme/slack/streams/poll"
				params={{ store: { type: "integration", kind: "kv", variants: ["Redis"], label: "Store" } }}
				names={["store"]}
				config={{ store: "m1" }}
				setField={() => {}}
			/>
		</QueryClientProvider>,
	);
	await settle();
	expect(view.getByRole("alert").textContent).toContain("this field takes only Redis");
	await choose(view as never);
	await settle();
	expect(view.getByText("cache-Redis")).toBeDefined();
	expect(view.queryByText("cache-Memcached")).toBeNull();
});
