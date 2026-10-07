import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// the canvas is React Flow, which happy-dom cannot lay out; show which level it would draw
mock.module("./OverlayCanvas", () => ({
	OverlayCanvas: ({
		customBlockId,
		level,
	}: {
		customBlockId: string | null;
		level: { seq: number }[];
	}) => (
		<div data-testid="canvas">
			{customBlockId ?? "own"}:{level.map((span) => span.seq).join(",")}
		</div>
	),
}));

const { cleanup, render, fireEvent, waitFor } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { RecordedRunViewer } = await import("./RecordedRunViewer");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const span = (seq: number, blockId: string, extra: Record<string, unknown> = {}) => ({
	seq,
	parentSeq: null,
	blockId,
	blockType: "js",
	blockName: null,
	customBlockId: null,
	middleware: null,
	startedAt: "2026-01-01T00:00:00.000Z",
	endedAt: "2026-01-01T00:00:00.004Z",
	outcome: "success",
	branch: null,
	error: null,
	input: null,
	output: null,
	truncated: false,
	...extra,
});

// the route calls custom block A twice; the second call runs B inside A, which fails
const run = {
	id: "run1",
	outcome: "failure",
	statusCode: 500,
	startedAt: "2026-01-01T00:00:00.000Z",
	endedAt: "2026-01-01T00:00:00.010Z",
	durationMs: 10,
	spanCount: 6,
	truncated: false,
	droppedSpans: 0,
	parentRunId: null,
	routeVersion: null,
	workflowVersion: null,
	parentSeq: null,
	childRuns: [],
	spans: [
		span(1, "inner", { parentSeq: 0, customBlockId: "A" }),
		span(0, "callA1", { blockType: "block_a" }),
		span(4, "innerB", { parentSeq: 3, customBlockId: "B", outcome: "failure", error: "boom" }),
		span(3, "callB", {
			parentSeq: 2,
			customBlockId: "A",
			blockType: "block_b",
			outcome: "failure",
		}),
		span(2, "callA2", { blockType: "block_a", outcome: "failure" }),
	],
};

function renderViewer() {
	const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
	client.setQueryData(["recordings", "p1", "route", "r1", "detail", "run1"], run);
	client.setQueryData(
		["custom-blocks", "p1"],
		[
			{ id: "A", name: "block_a", label: "Block A" },
			{ id: "B", name: "block_b", label: "Block B" },
		],
	);
	return render(
		<QueryClientProvider client={client}>
			<RecordedRunViewer
				projectId="p1"
				target={{ type: "route", id: "r1" }}
				runId="run1"
				onBack={() => {}}
			/>
		</QueryClientProvider>,
	);
}

test("drills into nested custom block calls, each call on its own, and back up", async () => {
	const view = renderViewer();
	expect(view.getByTestId("canvas").textContent).toBe("own:0,2");

	// two calls of Block A on the route: the second one is the one that ran Block B
	fireEvent.click(view.getAllByRole("button", { name: /Block A/ })[1]);
	fireEvent.click(view.getByRole("button", { name: /Open Block A/ }));
	await waitFor(() => expect(view.getByTestId("canvas").textContent).toBe("A:3"));

	fireEvent.click(view.getByRole("button", { name: /Block B/ }));
	fireEvent.click(view.getByRole("button", { name: /Open Block B/ }));
	await waitFor(() => expect(view.getByTestId("canvas").textContent).toBe("B:4"));
	expect(view.getByText("Route")).toBeTruthy();

	fireEvent.click(view.getByRole("button", { name: /js/ }));
	expect(view.getByText("boom")).toBeTruthy();

	fireEvent.click(view.getByText("Route"));
	await waitFor(() => expect(view.getByTestId("canvas").textContent).toBe("own:0,2"));
});
