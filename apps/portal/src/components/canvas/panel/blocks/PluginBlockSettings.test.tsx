import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
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

// useParams reads the router, which a settings panel test has none of
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useParams: () => ({ projectId: "p1" }),
}));

// Monaco cannot load under `bun test` (its setup imports Vite `?worker` entries,
// which only a bundler resolves). Stub the editor the lazy JavaScriptTextArea
// loads, in every file that renders one: the first file to load it decides it
// for the whole run, and a failed load breaks every later render.
mock.module(
	"../../../../../../../packages/components/src/JavaScriptTextArea/JavaScriptTextArea",
	() => ({
		JavaScriptTextArea: ({
			value,
			"aria-label": label,
		}: {
			value?: string;
			"aria-label"?: string;
		}) => <textarea aria-label={label} readOnly value={value} />,
	}),
);

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ReactFlowProvider, useNodes } = await import("@xyflow/react");
const { CanvasChangesProvider, DISABLED_CHANGES } = await import("../../changes/ChangesContext");
const { PluginBlocksContext } = await import("../../plugins/PluginBlocksContext");
const { blocksOf, slack } = await import("../../plugins/fixtures");
const { integrationService } = await import("@/services/integrations");
const { PluginBlockGeneral, PluginBlockSettings } = await import("./PluginBlockSettings");
const { DocsTab } = await import("../docs/DocsTab");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const TYPE = "acme/slack/messages/post";
const entry = (over: Record<string, unknown> = {}) => ({
	name: TYPE,
	label: "Post message",
	shape: "square",
	invoke: ["sync"],
	permissions: { integrations: ["kv"], appconfig: true },
	params: {},
	handles: { in: ["target"], out: ["success", "failure"], body: [] },
	deprecated: null,
	...over,
});

/** every param kind, one each, plus two that only show in advanced mode */
const params = {
	mode: { type: "select", options: ["simple", "advanced"], label: "Mode", default: "simple" },
	channel: { type: "string", label: "Channel", required: true, description: "Where to post" },
	retries: { type: "number", label: "Retries" },
	notify: { type: "boolean", label: "Notify" },
	expr: { type: "js", label: "Expression" },
	extra: { type: "json", label: "Extra" },
	conn: { type: "integration", kind: "kv", label: "Connection" },
	token: { type: "appconfig", label: "Token key" },
	when: { type: "conditions", label: "Only when" },
	shape: { type: "schema", label: "Shape", visibleWhen: { mode: "advanced" } },
	tuning: { type: "string", label: "Tuning", visibleWhen: { mode: ["advanced"] } },
	old: { type: "string", label: "Old", deprecated: "Use channel; removed in January." },
};

type Props = {
	over?: Record<string, unknown>;
	data?: Record<string, unknown>;
	editable?: boolean;
};

let nodes: { data: Record<string, unknown> }[] = [];
/** the node as the store holds it, so a save shows in what the panel renders next */
function Panel() {
	nodes = useNodes() as typeof nodes;
	const node = nodes[0] as never as { id: string; type: string; data: Record<string, unknown> };
	const block = { ...node, position: { x: 0, y: 0 } } as never;
	return (
		<>
			<PluginBlockGeneral block={block} />
			<PluginBlockSettings block={block} />
		</>
	);
}

function setup({ over = {}, data = {}, editable = true }: Props = {}) {
	const plugins = blocksOf(slack([entry({ params, ...over })]));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<PluginBlocksContext.Provider value={plugins}>
				<CanvasChangesProvider value={{ ...DISABLED_CHANGES, enabled: editable }}>
					<ReactFlowProvider
						defaultNodes={[{ id: "b1", type: TYPE, position: { x: 0, y: 0 }, data }]}
					>
						<Panel />
					</ReactFlowProvider>
				</CanvasChangesProvider>
			</PluginBlocksContext.Provider>
		</QueryClientProvider>,
	);
}

spyOn(integrationService, "getAll").mockResolvedValue([]);

test("every param kind renders with its label, required marker and description", () => {
	const { getByText, queryByText } = setup();
	for (const label of [
		"Mode",
		"Channel *",
		"Retries",
		"Notify",
		"Expression",
		"Extra",
		"Connection",
		"Token key",
		"Only when",
	])
		expect(getByText(label)).toBeDefined();
	expect(getByText("Where to post")).toBeDefined();
	expect(queryByText("Shape")).toBeNull();
});

test("a string and a number save under the param name, the number as a number", () => {
	const { getByLabelText } = setup();
	const channel = getByLabelText("Channel *") as HTMLInputElement;
	fireEvent.change(channel, { target: { value: "#ops" } });
	fireEvent.blur(channel);
	const retries = getByLabelText("Retries") as HTMLInputElement;
	fireEvent.change(retries, { target: { value: "3" } });
	fireEvent.blur(retries);
	expect(nodes[0]?.data.channel).toBe("#ops");
	expect(nodes[0]?.data.retries).toBe(3);
});

test("a boolean saves as a boolean", () => {
	const { getByRole } = setup();
	fireEvent.click(getByRole("checkbox"));
	expect(nodes[0]?.data.notify).toBe(true);
});

test("visibleWhen shows a param when the select says so, and a hidden one keeps its value", () => {
	const { queryByText, getByText } = setup({ data: { mode: "advanced", tuning: "fast" } });
	expect(getByText("Shape")).toBeDefined();
	expect(getByText("Tuning")).toBeDefined();
	cleanup();
	// defaults count: no mode saved means "simple"
	const simple = setup({ data: { tuning: "fast" } });
	expect(simple.queryByText("Shape")).toBeNull();
	expect(simple.queryByText("Tuning")).toBeNull();
	expect(nodes[0]?.data.tuning).toBe("fast");
	expect(queryByText("Shape")).toBeNull();
});

test("a deprecated param carries its message; a deprecated block gets a banner", () => {
	const { getByText, getByRole } = setup({ over: { deprecated: "Use Post v2." } });
	expect(getByText(/Deprecated: Use channel; removed in January\./)).toBeDefined();
	expect(within(getByRole("status")).getByText("Deprecated: Use Post v2.")).toBeDefined();
});

test("one invoke mode shows no dropdown; several show only the allowed ones", () => {
	const one = setup();
	expect(one.queryByText("Execution Mode")).toBeNull();
	cleanup();
	const many = setup({ over: { invoke: ["async", "queued"] } });
	expect(many.getByText("Execution Mode")).toBeDefined();
});

test("read-only disables every input", () => {
	const { container } = setup({ editable: false, data: { mode: "advanced" } });
	const inputs = [...container.querySelectorAll("input, textarea")] as HTMLInputElement[];
	expect(inputs.length).toBeGreaterThan(0);
	expect(inputs.filter((i) => !i.disabled && !i.readOnly)).toEqual([]);
});

test("the docs tab renders the manifest docs and the plugin link; no docs is just the link", () => {
	const at = (docs?: string) =>
		render(
			<QueryClientProvider client={new QueryClient()}>
				<PluginBlocksContext.Provider value={blocksOf(slack([entry({ docs })]))}>
					<DocsTab type={TYPE} />
				</PluginBlocksContext.Provider>
			</QueryClientProvider>,
		);
	const withDocs = at("## When to use it\n\nPost to a channel.");
	expect(withDocs.getByText("Post to a channel.")).toBeDefined();
	expect(withDocs.getByText("Plugin homepage").closest("a")?.getAttribute("href")).toBe(
		"https://example.com/slack",
	);
	cleanup();
	const bare = at();
	expect(bare.getByText("Plugin homepage")).toBeDefined();
	expect(bare.queryByText("No docs found.")).toBeNull();
});
