import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { testSuitesService } = await import("@/services/testSuites");
const { RunResults } = await import("./RunResults");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

const DETAIL = {
	id: "run1",
	status: "passed",
	env: "production",
	deploymentId: "deploy1",
	totalSuites: 1,
	passedCount: 1,
	failedCount: 0,
	durationMs: 12,
	startedAt: "2026-01-01T00:00:00.000Z",
	createdAt: "2026-01-01T00:00:00.000Z",
	finishedAt: "2026-01-01T00:00:00.012Z",
	result: {},
	traceExpired: false,
	suiteRuns: [],
};

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

test("a run shows its environment, and a gate run says it is a promote check", async () => {
	spyOn(testSuitesService, "getRun").mockResolvedValue(DETAIL as never);
	spyOn(testSuitesService, "getRuns").mockResolvedValue({
		data: [],
		pagination: { page: 1, totalPages: 0, hasNext: false },
	} as never);
	const view = render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<RunResults
				projectId="p1"
				target={{ type: "route", id: "r1" }}
				runId="run1"
				suiteId={null}
				suiteNames={{}}
				onSelectRun={() => {}}
			/>
		</QueryClientProvider>,
	);
	await until(() => view.getByText("Prod"));
	expect(view.getByText("Promote check")).toBeTruthy();
});

const suiteRun = (id: string, testSuiteId: string) => ({
	id,
	testSuiteId,
	status: "passed",
	durationMs: 5,
	result: null,
	traces: [],
});

test("the panel follows the suite picked on the left: its latest run, and only its result", async () => {
	// run1 ran every suite; run2, newer, ran only s2
	const runs = {
		run1: { ...DETAIL, id: "run1", suiteRuns: [suiteRun("a", "s1"), suiteRun("b", "s2")] },
		run2: { ...DETAIL, id: "run2", suiteRuns: [suiteRun("c", "s2")] },
	};
	spyOn(testSuitesService, "getRun").mockImplementation(
		(async (_p: string, _t: unknown, id: string) => runs[id as keyof typeof runs]) as never,
	);
	spyOn(testSuitesService, "getRuns").mockImplementation((async (
		_p: string,
		_t: unknown,
		query: { suiteId?: string },
	) => ({
		data: [{ id: query.suiteId === "s2" ? "run2" : "run1" }],
		pagination: { page: 1, totalPages: 1, hasNext: false },
	})) as never);

	const shown: (string | null)[] = [];
	const panel = (suiteId: string) => (
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<RunResults
				projectId="p1"
				target={{ type: "route", id: "r1" }}
				runId={null}
				suiteId={suiteId}
				suiteNames={{ s1: "Suite A", s2: "Suite B" }}
				onSelectRun={() => {}}
				onShownRunChange={(id) => shown.push(id)}
			/>
		</QueryClientProvider>
	);
	const view = render(panel("s2"));
	await until(() => view.getByText("Suite B"));
	expect(view.queryByText("Suite A")).toBeNull();
	expect(testSuitesService.getRun).toHaveBeenCalledWith("p1", expect.anything(), "run2");

	view.rerender(panel("s1"));
	await until(() => view.getByText("Suite A"));
	expect(view.queryByText("Suite B")).toBeNull();
	// the page keeps the shown run in its URL
	expect(shown.filter(Boolean)).toEqual(["run2", "run1"]);
});
