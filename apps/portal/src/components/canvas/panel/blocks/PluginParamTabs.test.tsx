import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
try {
	GlobalRegistrator.register();
} catch {}
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
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ReactFlowProvider, useNodes, useReactFlow } = await import("@xyflow/react");
const { CanvasChangesProvider, DISABLED_CHANGES } = await import("../../changes/ChangesContext");
const { PluginBlocksContext } = await import("../../plugins/PluginBlocksContext");
const { blocksOf, slack } = await import("../../plugins/fixtures");
const { integrationService } = await import("@/services/integrations");
const { BlockSettings } = await import("../BlockSettings");
const { PluginBlockSettings } = await import("./PluginBlockSettings");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
spyOn(integrationService, "getAll").mockResolvedValue([]);

const TYPE = "acme/slack/messages/post";
const entry = (params: object, tabs?: string[]) => ({
	name: TYPE,
	label: "Post message",
	shape: "square",
	invoke: ["sync"],
	permissions: {},
	params,
	...(tabs ? { tabs } : {}),
	handles: { in: ["target"], out: ["success", "failure"], body: [] },
	deprecated: null,
});

let nodes: { data: Record<string, unknown> }[] = [];
let setData: (data: Record<string, unknown>) => void = () => {};
/** the node as the store holds it, so a save shows in what the panel renders next */
function Panel() {
	nodes = useNodes() as typeof nodes;
	const { updateNodeData } = useReactFlow();
	setData = (data) => updateNodeData("b1", data);
	const node = nodes[0] as never as { id: string; type: string; data: Record<string, unknown> };
	return <PluginBlockSettings block={{ ...node, position: { x: 0, y: 0 } } as never} />;
}

function setup(
	params: object,
	{
		tabs,
		data = {},
		editable = true,
	}: { tabs?: string[]; data?: Record<string, unknown>; editable?: boolean } = {},
) {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<PluginBlocksContext.Provider value={blocksOf(slack([entry(params, tabs)]))}>
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

async function until(check: () => void, timeout = 1500) {
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

const tabNames = (view: ReturnType<typeof setup>) =>
	view.queryAllByRole("tab").map((t) => t.textContent);

const tabbed = {
	mode: {
		type: "select",
		options: ["basic", "pro"],
		label: "Mode",
		default: "basic",
		tab: "General",
		order: 0,
	},
	token: { type: "string", label: "Token", tab: "Auth", order: 0 },
	tuning: {
		type: "string",
		label: "Tuning",
		tab: "Advanced",
		order: 0,
		visibleWhen: { mode: "pro" },
	},
	help: { type: "hint", text: "Only for **pro**.", tab: "Advanced", order: 1 },
};

test("one tab per used tab, in the manifest's order; a tab whose params are all hidden is gone", () => {
	const view = setup(tabbed, { tabs: ["General", "Auth", "Advanced"] });
	expect(tabNames(view)).toEqual(["General", "Auth"]);
	cleanup();
	expect(
		tabNames(setup(tabbed, { tabs: ["Auth", "General", "Advanced"], data: { mode: "pro" } })),
	).toEqual(["Auth", "General", "Advanced"]);
});

test("when the open tab is hidden, the first visible one is selected", () => {
	const view = setup(tabbed, { tabs: ["General", "Auth", "Advanced"], data: { mode: "pro" } });
	fireEvent.click(view.getByRole("tab", { name: "Advanced" }));
	expect(view.getByRole("tab", { name: "Advanced" }).getAttribute("aria-selected")).toBe("true");
	act(() => setData({ mode: "basic" }));
	expect(tabNames(view)).toEqual(["General", "Auth"]);
	expect(view.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
});

test("a single visible tab renders without a tab bar", () => {
	const view = setup({ a: { type: "string", label: "Only" } });
	expect(view.queryByRole("tablist")).toBeNull();
	expect(view.getByText("Only")).toBeDefined();
});

test("params sort by order within a tab, a hint between them", () => {
	const view = setup({
		b: { type: "string", label: "Second", order: 2 },
		note: { type: "hint", text: "Between the two.", tone: "tip", order: 1 },
		a: { type: "string", label: "First", order: 0 },
	});
	const text = view.container.textContent ?? "";
	expect(text.indexOf("First")).toBeLessThan(text.indexOf("Between the two."));
	expect(text.indexOf("Between the two.")).toBeLessThan(text.indexOf("Second"));
	expect(view.getByText("Tip")).toBeDefined();
});

test("a hint hides by visibleWhen, and alone does not keep its tab", () => {
	const view = setup({
		mode: { type: "select", options: ["a", "b"], label: "Mode", default: "a" },
		note: { type: "hint", text: "Only in b.", visibleWhen: { mode: "b" } },
		lone: { type: "hint", text: "Alone here.", tab: "Help" },
	});
	expect(view.queryByText("Only in b.")).toBeNull();
	expect(view.queryByText("Alone here.")).toBeNull();
	expect(view.queryByRole("tablist")).toBeNull();
	act(() => setData({ mode: "b" }));
	expect(view.getByText("Only in b.")).toBeDefined();
});

test("string renders the JS text field; js renders the code editor", () => {
	const view = setup(
		{ s: { type: "string", label: "Text" }, code: { type: "js", label: "Code" } },
		{ data: { code: "js:return 1;" } },
	);
	expect(view.getByLabelText("Use a JavaScript expression")).toBeDefined();
	// the multi-line editor, labelled by the param
	expect(view.getByLabelText("Expand code editor")).toBeDefined();
	// holding the code without its `js:`
	return until(() =>
		expect((view.getByLabelText("Code") as HTMLTextAreaElement).value).toBe("return 1;"),
	);
});

test("keyValue adds, edits and removes rows, and refuses a repeated key", () => {
	const view = setup({
		headers: { type: "keyValue", label: "Headers", keys: { placeholder: "Header" } },
	});
	const add = () => fireEvent.click(view.getByRole("button", { name: /Add Row/ }));
	const keys = () => view.getAllByPlaceholderText("Header") as HTMLInputElement[];
	const values = () => view.getAllByPlaceholderText("Row Value") as HTMLInputElement[];
	add();
	fireEvent.change(keys()[0]!, { target: { value: "id" } });
	fireEvent.change(values()[0]!, { target: { value: "js:return input.id" } });
	expect(nodes[0]?.data.headers).toEqual({ id: "js:return input.id" });
	add();
	fireEvent.change(keys()[1]!, { target: { value: "id " } });
	expect(within(view.container).getByRole("alert").textContent).toBe("The key 'id' is used twice.");
	expect(nodes[0]?.data.headers).toEqual({ id: "js:return input.id" });
	fireEvent.click(view.getAllByRole("button", { name: "Remove row" })[1]!);
	expect(view.queryByRole("alert")).toBeNull();
	fireEvent.click(view.getAllByRole("button", { name: "Remove row" })[0]!);
	expect(nodes[0]?.data.headers).toEqual({});
});

test("array holds min and max; fieldMap renders the field map editor", () => {
	const view = setup({
		to: { type: "array", label: "To", of: "email", min: 1, max: 1 },
		map: { type: "fieldMap", label: "Map" },
	});
	const add = () => fireEvent.click(view.getByRole("button", { name: /Add email/ }));
	add();
	expect(view.queryByRole("alert")).toBeNull();
	add();
	expect(view.getByRole("alert").textContent).toBe("Takes at most 1.");
	expect(view.getByRole("button", { name: /Add New Field Map/ })).toBeDefined();
});

test("read-only disables the keyValue, array and fieldMap editors", () => {
	const view = setup(
		{
			headers: { type: "keyValue", label: "Headers" },
			to: { type: "array", label: "To" },
			map: { type: "fieldMap", label: "Map" },
		},
		{ editable: false, data: { headers: { a: "1" }, to: ["x"], map: { a: "b" } } },
	);
	const inputs = [...view.container.querySelectorAll("input, textarea")] as HTMLInputElement[];
	expect(inputs.length).toBeGreaterThan(3);
	expect(inputs.filter((i) => !i.disabled && !i.readOnly)).toEqual([]);
	const buttons = [...view.container.querySelectorAll("button")].filter((b) =>
		/Add|Remove/.test(b.textContent + (b.getAttribute("aria-label") ?? "")),
	);
	expect(buttons.length).toBeGreaterThan(0);
	expect(buttons.filter((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true")).toEqual(
		[],
	);
});

test("RTL (tabs): a plugin block with tabs: ['Body', 'Advanced'] shows the top-level tabs General, Body, Advanced, then Docs, with no Parameters tab; params with no tab land in General; a tab whose params are all hidden is not shown", () => {
	const blockParams = {
		subject: { type: "string", label: "Subject" },
		html: { type: "string", label: "HTML Body", tab: "Body" },
		timeout: {
			type: "number",
			label: "Timeout",
			tab: "Advanced",
			visibleWhen: { subject: "custom" },
		},
	};

	function SettingsPanel({ data = {} }: { data?: Record<string, unknown> }) {
		return (
			<QueryClientProvider client={new QueryClient()}>
				<PluginBlocksContext.Provider
					value={blocksOf(slack([entry(blockParams, ["Body", "Advanced"])]))}
				>
					<CanvasChangesProvider value={{ ...DISABLED_CHANGES, enabled: true }}>
						<ReactFlowProvider
							defaultNodes={[{ id: "b1", type: TYPE, position: { x: 0, y: 0 }, data }]}
						>
							<BlockSettings
								block={
									{
										id: "b1",
										type: TYPE,
										position: { x: 0, y: 0 },
										data,
									} as never
								}
							/>
						</ReactFlowProvider>
					</CanvasChangesProvider>
				</PluginBlocksContext.Provider>
			</QueryClientProvider>
		);
	}

	const view1 = render(<SettingsPanel data={{ subject: "custom" }} />);
	expect(view1.queryAllByRole("tab").map((t) => t.textContent)).toEqual([
		"General",
		"Body",
		"Advanced",
		"Docs",
	]);
	expect(view1.queryByRole("tab", { name: "Parameters" })).toBeNull();
	expect(view1.getByText("Subject")).toBeDefined();
	cleanup();

	const view2 = render(<SettingsPanel data={{ subject: "default" }} />);
	expect(view2.queryAllByRole("tab").map((t) => t.textContent)).toEqual([
		"General",
		"Body",
		"Docs",
	]);
	expect(view2.queryByRole("tab", { name: "Advanced" })).toBeNull();
	cleanup();
});
