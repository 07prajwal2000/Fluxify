import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

const { cleanup, render, fireEvent } = await import("@testing-library/react");
const { PayloadViewer } = await import("./PayloadViewer");
const { RecordingIndicator } = await import("./RecordingControls");
const { SpanTimeline } = await import("./SpanTimeline");
const { SpanDetail } = await import("./SpanDetail");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const sampleSpan = (
	seq: number,
	blockId: string,
	durationMs = 10,
	extra: Record<string, unknown> = {},
) => ({
	seq,
	parentSeq: null,
	blockId,
	blockType: "js",
	blockName: `Block ${seq}`,
	customBlockId: null,
	middleware: null,
	startedAt: "2026-01-01T00:00:00.000Z",
	endedAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + durationMs).toISOString(),
	outcome: "success" as const,
	branch: null,
	error: null,
	input: { foo: "bar" },
	output: { baz: 123 },
	truncated: false,
	...extra,
});

test("RecordingIndicator displays active recording badge", () => {
	const view = render(<RecordingIndicator />);
	expect(view.getByText("Recording Active")).toBeTruthy();
});

test("PayloadViewer toggles open/collapsed and marks truncated payloads", () => {
	const view = render(
		<PayloadViewer title="Input Data" value={{ key: "value" }} truncated={true} />,
	);
	expect(view.getByText("Input Data")).toBeTruthy();
	expect(view.getByText("Truncated at 8 KB")).toBeTruthy();

	// Toggle collapse
	const toggleButton = view.getByRole("button", { name: /^Input Data/ });
	expect(view.container.querySelector('[style*="height: 160px"]')).toBeTruthy();

	fireEvent.click(toggleButton);
	// Content container should be unmounted when collapsed
	expect(view.container.querySelector('[style*="height: 160px"]')).toBeNull();

	// Toggle open again
	fireEvent.click(toggleButton);
	expect(view.container.querySelector('[style*="height: 160px"]')).toBeTruthy();
});

test("SpanTimeline displays spans and waterfall bars with onSelect trigger", () => {
	const spans = [
		sampleSpan(1, "b1", 10),
		sampleSpan(2, "b2", 100), // slow block
	];
	let selectedId: string | null = null;
	const view = render(
		<SpanTimeline
			level={spans}
			allSpans={spans}
			selected={null}
			onSelect={(id) => {
				selectedId = id;
			}}
			nameOf={(s) => s.blockName ?? s.blockType}
		/>,
	);

	expect(view.getByText("Timeline Waterfall")).toBeTruthy();
	expect(view.getByText("Block 1")).toBeTruthy();
	expect(view.getByText("Block 2")).toBeTruthy();
	expect(view.getByText("Slow")).toBeTruthy();

	// Click to select
	fireEvent.click(view.getByText("Block 1"));
	expect(selectedId as string | null).toBe("b1");
});

test("SpanDetail allows toggling between List and Timeline views", () => {
	const spans = [sampleSpan(1, "b1", 10)];
	const run = {
		id: "run1",
		outcome: "success" as const,
		statusCode: 200,
		startedAt: "2026-01-01T00:00:00.000Z",
		endedAt: "2026-01-01T00:00:00.010Z",
		durationMs: 10,
		spanCount: 1,
		truncated: false,
		droppedSpans: 0,
		parentRunId: null,
		routeVersion: null,
		workflowVersion: null,
		parentSeq: null,
		childRuns: [],
		spans,
	};

	let selected: string | null = null;
	const view = render(
		<SpanDetail
			run={run}
			level={spans}
			selected={selected}
			onSelect={(id) => {
				selected = id;
			}}
			actions={{
				nameOf: (s) => s.blockName ?? s.blockType,
				openCall: () => {},
				openChild: () => {},
			}}
		/>,
	);

	// Initial view is List
	expect(view.getByText("Select a block on the canvas or below.")).toBeTruthy();
	expect(view.getByText("Block 1")).toBeTruthy();

	// Switch to Timeline
	fireEvent.click(view.getByRole("button", { name: "Timeline" }));
	expect(view.getByText("Waterfall timeline of recorded execution.")).toBeTruthy();
	expect(view.getByText("Timeline Waterfall")).toBeTruthy();

	// Switch back to List
	fireEvent.click(view.getByRole("button", { name: "List" }));
	expect(view.getByText("Select a block on the canvas or below.")).toBeTruthy();
});

test("SplitPane renders separator and handles keyboard resizing", async () => {
	const { SplitPane } = await import("../common/SplitPane");
	const view = render(
		<SplitPane
			left={<div>Left Pane</div>}
			right={<div>Right Pane</div>}
			initial={50}
			label="Resize panes"
		/>,
	);

	expect(view.getByText("Left Pane")).toBeTruthy();
	expect(view.getByText("Right Pane")).toBeTruthy();
	const separator = view.getByRole("separator");
	expect(separator).toBeTruthy();
	expect(separator.getAttribute("aria-valuenow")).toBe("50");

	fireEvent.keyDown(separator, { key: "ArrowLeft" });
	expect(separator.getAttribute("aria-valuenow")).toBe("45");

	fireEvent.keyDown(separator, { key: "ArrowRight" });
	expect(separator.getAttribute("aria-valuenow")).toBe("50");
});

test("ExecutionTargetHeader renders active recording badges and triggers target selection", async () => {
	const { ExecutionTargetHeader } = await import("./ExecutionTargetHeader");
	let selectedType = "route";
	let selectedId = "r1";

	const routes = [
		{
			id: "r1",
			name: "Users",
			method: "GET",
			path: "/users",
			recordExecution: false,
			active: true,
		},
		{
			id: "r2",
			name: "Create",
			method: "POST",
			path: "/users",
			recordExecution: true,
			active: true,
		},
	];
	const workflows = [
		{
			id: "w1",
			name: "Nightly Sync",
			recordExecution: true,
			active: true,
			description: "Sync data",
			projectId: "p1",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			timeoutSeconds: 300,
			tracingEnabled: false,
			blocks: [],
			edges: [],
		},
	];

	const view = render(
		<ExecutionTargetHeader
			projectId="p1"
			targetType={selectedType as "route"}
			targetId={selectedId}
			routes={routes}
			workflows={workflows}
			onSelectTarget={(type, id) => {
				selectedType = type;
				selectedId = id;
			}}
			onOpenCanvas={() => {}}
			onOpenPlayground={() => {}}
			onOpenRunWorkflow={() => {}}
		/>,
	);

	expect(view.getByText("Executions")).toBeTruthy();
	expect(view.getByText("Routes (2)")).toBeTruthy();
	expect(view.getByText("Workflows (1)")).toBeTruthy();
	expect(view.getByRole("button", { name: "Target actions" })).toBeTruthy();

	// Switch to workflows
	const workflowBtn = view.getByRole("button", { name: "Workflows (1)" });
	fireEvent.click(workflowBtn);
	expect(selectedType).toBe("workflow");
	expect(selectedId).toBe("w1");
});

test("FlowEdge hides action buttons and delete button when canvas is read-only", async () => {
	const { FlowEdge } = await import("../canvas/edges/FlowEdge");
	const { CanvasReadOnlyProvider } = await import("../canvas/CanvasReadOnlyContext");
	const { ReactFlowProvider, Position } = await import("@xyflow/react");

	const view = render(
		<ReactFlowProvider>
			<CanvasReadOnlyProvider readOnly={true}>
				<svg>
					<title>Edge test</title>
					<FlowEdge
						id="e1"
						source="s"
						target="t"
						sourceX={0}
						sourceY={0}
						targetX={100}
						targetY={100}
						sourcePosition={Position.Right}
						targetPosition={Position.Left}
						selected={true}
					/>
				</svg>
			</CanvasReadOnlyProvider>
		</ReactFlowProvider>,
	);

	expect(view.queryByTitle("Delete connection")).toBeNull();
	expect(view.queryByLabelText("Delete connection")).toBeNull();
});
