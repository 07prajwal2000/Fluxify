import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { RecordedRunList } = await import("./RecordedRunList");
const { recordingsService } = await import("@/services/recordings");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

const run = (id: string, env: "development" | "production") => ({
	id,
	outcome: "success" as const,
	statusCode: 200,
	startedAt: "2026-01-01T00:00:00.000Z",
	endedAt: "2026-01-01T00:00:00.010Z",
	durationMs: 10,
	spanCount: 1,
	truncated: false,
	droppedSpans: 0,
	parentRunId: null,
	env,
	metadata: null,
});

/** Not RTL's waitFor/screen: they stay bound to the DOM of whichever test file loaded RTL first. */
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

test("every run carries an environment chip, and the dropdown filters by env", async () => {
	const getRuns = spyOn(recordingsService, "getRuns").mockResolvedValue({
		data: [run("a", "development"), run("b", "production")],
		pagination: { page: 1, perPage: 10, total: 2, totalPages: 1 },
	} as never);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, staleTime: Infinity } },
	});
	client.setQueryData(["routes", "r1", "by-id"], {
		id: "r1",
		method: "GET",
		path: "/orders",
		recordExecution: false,
	});
	client.setQueryData(["public-settings"], { recordingMaxAgeDays: 30 });
	const view = render(
		<QueryClientProvider client={client}>
			<RecordedRunList
				projectId="p1"
				target={{ type: "route", id: "r1" }}
				emptyHint="send a request"
				onOpen={() => {}}
			/>
		</QueryClientProvider>,
	);

	await until(() => expect(view.getByText("Dev")).toBeTruthy());
	expect(view.getByText("Prod")).toBeTruthy();
	// the default is every environment: no env on the request
	expect(getRuns.mock.calls[0]?.[2]).not.toHaveProperty("env", "production");
	expect((getRuns.mock.calls[0]?.[2] as { env?: string }).env).toBeUndefined();

	await act(async () => {
		fireEvent.click(view.getByRole("button", { name: /Filter by environment/ }));
	});
	await act(async () => {
		fireEvent.click(await until(() => view.getByRole("option", { name: "Production" })));
	});
	await until(() => {
		const last = getRuns.mock.calls.at(-1)?.[2] as { env?: string };
		expect(last.env).toBe("production");
	});
});
