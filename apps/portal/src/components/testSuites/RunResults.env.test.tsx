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
	const view = render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<RunResults
				projectId="p1"
				target={{ type: "route", id: "r1" }}
				runId="run1"
				suiteNames={{}}
				onSelectRun={() => {}}
			/>
		</QueryClientProvider>,
	);
	await until(() => view.getByText("Prod"));
	expect(view.getByText("Promote check")).toBeTruthy();
});
