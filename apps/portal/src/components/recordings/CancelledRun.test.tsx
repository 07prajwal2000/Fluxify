import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { recordingsService } = await import("@/services/recordings");
const { workflowsService } = await import("@/services/workflows");
const { publicSettingsService } = await import("@/services/publicSettings");
const { RecordedRunList } = await import("./RecordedRunList");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

const run = (id: string, outcome: "success" | "cancelled") => ({
	id,
	outcome,
	statusCode: null,
	startedAt: "2026-01-02T00:00:00.000Z",
	endedAt: "2026-01-02T00:00:00.010Z",
	durationMs: 10,
	spanCount: 2,
	truncated: false,
	droppedSpans: 0,
	parentRunId: null,
	versionId: null,
	versionNumber: null,
	graph: "working copy",
	values: "development" as const,
	metadata: null,
});

function stub() {
	const runs = spyOn(recordingsService, "getRuns").mockResolvedValue({
		data: [run("stopped", "cancelled"), run("done", "success")],
		pagination: { page: 1, perPage: 20, totalPages: 1, hasNext: false },
	} as never);
	spyOn(workflowsService, "getById").mockResolvedValue({
		id: "w1",
		projectId: "p1",
		name: "Agent",
		recordExecution: false,
		devRecordExecution: false,
	} as never);
	spyOn(publicSettingsService, "get").mockResolvedValue({ recordingMaxAgeDays: 30 } as never);
	return runs;
}

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

function mount() {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<RecordedRunList
				projectId="p1"
				target={{ type: "workflow", id: "w1" }}
				emptyHint="run the workflow"
				onOpen={() => {}}
			/>
		</QueryClientProvider>,
	);
}

test("a stopped run shows a Cancelled chip and a stop icon; a finished run does not", async () => {
	stub();
	const view = mount();
	await until(() => view.getByLabelText("Cancelled"));
	// the chip, plus the "Cancelled" filter button
	expect(view.getAllByText("Cancelled")).toHaveLength(2);
	expect(view.getAllByLabelText("Succeeded")).toHaveLength(1);
});

test("the Cancelled filter asks the server for stopped runs", async () => {
	const runs = stub();
	const view = mount();
	const filter = await until(() => view.getByRole("button", { name: "Cancelled" }));
	fireEvent.click(filter);
	await until(() =>
		expect(runs.mock.calls.some((call) => call[2]?.outcome === "cancelled")).toBe(true),
	);
});
