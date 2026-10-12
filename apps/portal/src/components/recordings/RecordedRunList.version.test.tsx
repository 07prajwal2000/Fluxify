import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { recordingsService } = await import("@/services/recordings");
const { routesService } = await import("@/services/routes");
const { publicSettingsService } = await import("@/services/publicSettings");
const { RecordedRunList } = await import("./RecordedRunList");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

const RUNS = [
	{
		id: "run-prod",
		outcome: "success" as const,
		statusCode: 200,
		startedAt: "2026-01-02T00:00:00.000Z",
		endedAt: "2026-01-02T00:00:00.010Z",
		durationMs: 10,
		spanCount: 1,
		truncated: false,
		droppedSpans: 0,
		parentRunId: null,
		versionId: "version-2",
		versionNumber: 2,
		graph: "v2",
		values: "production" as const,
		metadata: null,
	},
	{
		id: "run-dev",
		outcome: "success" as const,
		statusCode: 200,
		startedAt: "2026-01-01T00:00:00.000Z",
		endedAt: "2026-01-01T00:00:00.010Z",
		durationMs: 10,
		spanCount: 1,
		truncated: false,
		droppedSpans: 0,
		parentRunId: null,
		versionId: null,
		versionNumber: null,
		graph: "working copy",
		values: "development" as const,
		metadata: null,
	},
];

function stub() {
	const runs = spyOn(recordingsService, "getRuns").mockResolvedValue({
		data: RUNS,
		pagination: { page: 1, perPage: 20, totalPages: 1, hasNext: false },
	} as never);
	spyOn(routesService, "getById").mockResolvedValue({
		id: "r1",
		projectId: "p1",
		method: "GET",
		path: "/orders",
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

function mount(versionId?: string) {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<RecordedRunList
				projectId="p1"
				target={{ type: "route", id: "r1" }}
				emptyHint="send a request"
				onOpen={() => {}}
				versionId={versionId}
			/>
		</QueryClientProvider>,
	);
}

test("each run shows its version: vN, or working copy on development", async () => {
	stub();
	const view = mount();
	await until(() => view.getByText("v2"));
	expect(view.getByText("working copy")).toBeTruthy();
});

test("a version id narrows the list to that version's runs", async () => {
	const runs = stub();
	mount("version-2");
	await until(() =>
		expect(runs.mock.calls.some((call) => call[2]?.versionId === "version-2")).toBe(true),
	);
});
