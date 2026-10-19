import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, render, fireEvent } = await import("@testing-library/react");
const { SpanDetail } = await import("./SpanDetail");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const at = (ms: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, ms)).toISOString();
const span = (
	seq: number,
	blockId: string,
	blockName: string,
	start: number,
	extra: Record<string, unknown> = {},
) => ({
	seq,
	parentSeq: null,
	blockId,
	blockType: "js",
	blockName,
	customBlockId: null,
	middleware: null,
	startedAt: at(start),
	endedAt: at(start + 5),
	outcome: "success",
	branch: null,
	error: null,
	input: null,
	output: null,
	truncated: false,
	metadata: null,
	...extra,
});

// Tool (seq 4) ran ctx.span "outer" > "inner", and its execute chain's block "Double"
const level = [
	span(4, "tool", "Tool", 0),
	span(3, "chain", "Double", 20, { metadata: { owner: "tool" } }),
];
const run = {
	spans: [
		span(0, "inner-id", "inner", 11, {
			blockType: "span",
			parentSeq: 4,
			metadata: { parent: "outer-id" },
		}),
		span(1, "outer-id", "outer", 10, { blockType: "span", parentSeq: 4 }),
		...level,
	],
	childRuns: [],
} as any;

const actions = {
	nameOf: (s: { blockName: string | null }) => s.blockName ?? "",
	openCall: () => {},
	openChild: () => {},
};

test("nests ctx.span children and body-chain spans under their block", () => {
	const view = render(
		<SpanDetail
			run={run}
			level={level as any}
			selected={null}
			onSelect={() => {}}
			actions={actions}
		/>,
	);
	const rows = view
		.getAllByRole("button")
		.filter((b) => /^(Tool|outer|inner|Double)/.test(b.textContent ?? ""));
	expect(rows.map((b) => b.textContent?.replace(/\d+ms$/, ""))).toEqual([
		"Tool",
		"outer",
		"inner",
		"Double",
	]);
	const indent = rows.map((b) => (b as HTMLElement).style.paddingLeft);
	expect(indent).toEqual(["0.5rem", "1.75rem", "3rem", "1.75rem"]);
});

test("a ctx.span child can be opened by its own id", () => {
	let picked: string | null = null;
	const view = render(
		<SpanDetail
			run={run}
			level={level as any}
			selected={null}
			onSelect={(id) => {
				picked = id;
			}}
			actions={actions}
		/>,
	);
	fireEvent.click(view.getByRole("button", { name: /inner/ }));
	expect(picked as string | null).toBe("inner-id");
	cleanup();
	const detail = render(
		<SpanDetail
			run={run}
			level={level as any}
			selected="inner-id"
			onSelect={() => {}}
			actions={actions}
		/>,
	);
	expect(detail.queryByText("This block did not run in this recording.")).toBeNull();
});
