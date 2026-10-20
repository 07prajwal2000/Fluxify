import { afterAll, afterEach, expect, test } from "bun:test";
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
	},
});

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { cleanup, render } = await import("@testing-library/react");
const { ReactFlow, ReactFlowProvider } = await import("@xyflow/react");
const { createBlockNodeTypes } = await import("../blocks/BlockNode");
const { PluginBlocksContext } = await import("./PluginBlocksContext");
const { buildPluginBlocks } = await import("./PluginBlocksContext");
const { agent, blocksOf, legacy, post, slack } = await import("./fixtures");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const nodeTypes = createBlockNodeTypes();
const at = (x: number) => ({ x, y: 0 });

function draw(
	blocks: ReturnType<typeof blocksOf>,
	nodes: { id: string; type: string; data?: Record<string, unknown> }[],
	edges: {
		id: string;
		source: string;
		sourceHandle: string;
		target: string;
		targetHandle?: string;
	}[] = [],
) {
	return render(
		<PluginBlocksContext.Provider value={blocks}>
			<ReactFlowProvider>
				<div style={{ width: 1000, height: 600 }}>
					<ReactFlow
						nodes={nodes.map((n, i) => ({ data: {}, position: at(i * 300), ...n }))}
						edges={edges}
						nodeTypes={nodeTypes}
					/>
				</div>
			</ReactFlowProvider>
		</PluginBlocksContext.Provider>,
	);
}

const handle = (view: ReturnType<typeof draw>, id: string) =>
	view.container.querySelector(`[data-handleid="${id}"]`);

test("a wide block shows every body handle, two stacked on one corner, each named", () => {
	const view = draw(blocksOf(slack([agent])), [{ id: "a1", type: agent.name }]);

	expect(view.container.querySelector(".fx-block--compact")).toBeNull();
	for (const name of ["tools", "memory", "approval", "target", "success", "failure"]) {
		expect(handle(view, `a1-${name}`)).not.toBeNull();
	}
	const rail = (corner: string) => view.container.querySelector(`.fx-block__rail--${corner}`);
	expect(rail("bottom-left")?.querySelectorAll(".react-flow__handle")).toHaveLength(2);
	expect(
		[...(rail("bottom-left")?.querySelectorAll(".fx-handle-slot__label") ?? [])].map(
			(l) => l.textContent,
		),
	).toEqual(["tools", "memory"]);
	expect(rail("top-right")?.querySelectorAll(".react-flow__handle")).toHaveLength(1);
	// a body handle leaves from the edge its corner is on
	expect(handle(view, "a1-tools")?.className).toContain("fx-handle--bottom");
	expect(handle(view, "a1-approval")?.className).toContain("fx-handle--top");
	// pinned to the corner side, so the first socket of each corner lines up whatever its name
	const slots = (corner: string) =>
		[...(rail(corner)?.querySelectorAll(".fx-handle-slot") ?? [])].map((s) => s.className);
	for (const slot of slots("bottom-left")) expect(slot).toContain("fx-handle-slot--start");
	for (const slot of slots("top-right")) expect(slot).toContain("fx-handle-slot--end");
});

test("a square block is the compact card with its outputs on the right", () => {
	const view = draw(blocksOf(slack([post])), [{ id: "p1", type: post.name }]);

	expect(view.container.querySelector(".fx-block--compact")).not.toBeNull();
	expect(handle(view, "p1-target")?.className).toContain("fx-handle--left");
	expect(handle(view, "p1-success")?.className).toContain("fx-handle--right");
	expect(handle(view, "p1-failure")?.className).toContain("fx-handle--right");
});

test("a single body handle takes one edge, an allowMultiple one takes several", () => {
	const nodes = [
		{ id: "a1", type: agent.name },
		{ id: "x", type: post.name },
		{ id: "y", type: post.name },
	];
	const view = draw(blocksOf(slack([agent, post])), nodes, [
		{ id: "e1", source: "a1", sourceHandle: "a1-memory", target: "x" },
		{ id: "e2", source: "a1", sourceHandle: "a1-tools", target: "x" },
		{ id: "e3", source: "a1", sourceHandle: "a1-tools", target: "y" },
	]);

	// the single one is full: no second edge can start from it
	expect(handle(view, "a1-memory")?.className).toContain("fx-handle--full");
	expect(handle(view, "a1-tools")?.className).not.toContain("fx-handle--full");
	expect(handle(view, "a1-approval")?.className).not.toContain("fx-handle--full");
	// builtin rule for outputs: one edge each
	expect(handle(view, "a1-success")?.className).not.toContain("fx-handle--full");
});

test("a deprecated block carries a badge whose tooltip is the message", () => {
	const view = draw(blocksOf(slack([post, legacy])), [
		{ id: "l1", type: legacy.name },
		{ id: "p1", type: post.name },
	]);

	const badges = view.getAllByLabelText(/^Deprecated:/);
	expect(badges).toHaveLength(1);
	expect(badges[0]?.getAttribute("title")).toBe(legacy.deprecated);
});

test("a block's own name wins over the manifest label", () => {
	const view = draw(blocksOf(slack([post])), [
		{ id: "p1", type: post.name, data: { blockName: "Tell the team" } },
	]);
	expect(view.getAllByText("Tell the team").length).toBeGreaterThan(0);
	expect(view.queryByText("Post message")).toBeNull();
});

test("a block of a plugin that is not installed renders as such, and keeps its edges", () => {
	const view = draw(
		blocksOf(slack([post])),
		[
			{ id: "p1", type: post.name },
			{ id: "gone", type: "acme/ghost/run/step" },
		],
		[
			{
				id: "e1",
				source: "p1",
				sourceHandle: "p1-success",
				target: "gone",
				targetHandle: "gone-target",
			},
		],
	);

	expect(view.getByText("Plugin acme/ghost is not installed")).toBeTruthy();
	// the handle its edge ends on is rebuilt from the edge, and cannot take another
	expect(handle(view, "gone-target")?.className).toContain("fx-handle--full");
});

test("while the plugins load, a plugin block is not yet called missing", () => {
	const view = draw(buildPluginBlocks([], true), [{ id: "x", type: "acme/ghost/run/step" }]);
	expect(view.queryByText(/is not installed/)).toBeNull();
	expect(view.getByText("Loading plugins…")).toBeTruthy();
});

test("a rejected plugin's blocks are missing; a pending upgrade still serves the live version", () => {
	const rejected = slack([{ ...post, name: "acme/gone/run/step" }], {
		name: "acme/gone",
		approval: "rejected",
	});
	const upgrading = slack([legacy], {
		approval: "pending",
		live: {
			version: "1.0.0",
			integrity: "sha512-abc",
			source: "npm",
			location: "x",
			permissions: null,
			manifest: slack([post]).manifest,
		},
	});
	const view = draw(blocksOf(rejected, upgrading), [
		{ id: "s1", type: "acme/gone/run/step" },
		{ id: "p1", type: post.name },
		{ id: "l1", type: legacy.name },
	]);

	// the live version has post; legacy is only in the version waiting for approval
	const missing = [...view.container.querySelectorAll(".fx-block--missing")];
	expect(missing.map((el) => el.getAttribute("data-block-id"))).toEqual(["s1", "l1"]);
});
