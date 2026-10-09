import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ToolPart } from "../agentMessages";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
mock.module("@tanstack/react-router", () => ({
	useParams: () => ({ projectId: "p1" }),
	Link: ({ to, children, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ToolBody } = await import("./ToolBody");
const { agentConversationsService } = await import("@/services/agentConversations");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

async function until<T>(check: () => T, timeout = 2000): Promise<T> {
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
const show = (tool: Partial<ToolPart> & { name: string }, asking = false) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ToolBody tool={{ type: "tool", id: "t", input: {}, ...tool }} asking={asking} />
		</QueryClientProvider>,
	);

test("call_route: request line, status, the body folded when long, and the blocks that ran by key", async () => {
	const read = spyOn(agentConversationsService, "resourcePreview").mockResolvedValue({
		current: { method: "POST", path: "/users/:id" },
	});
	const big = Array.from({ length: 40 }, (_, i) => ({ id: i, name: `user ${i}` }));
	const view = show({
		name: "call_route",
		input: { routeId: "r1", params: { id: "42" }, query: { dry: "1" }, body: { name: "Ann" } },
		output: {
			status: 500,
			durationMs: 31,
			body: big,
			error: {
				block: { key: "db_insert_1", type: "db_insert" },
				message: "duplicate key",
				detail: "users_email_key",
			},
			trace: [
				"entrypoint_1 (entrypoint) ok 0ms",
				'validate_1 (jsrunner) ok 3ms → {"ok":true}',
				"db_insert_1 (db_insert) ERROR 12ms: duplicate key",
				"… 4 more blocks, see get_recording",
			],
		},
		status: "error",
	});
	await until(() => expect(view.container.textContent).toContain("POST /users/42?dry=1"));
	const text = view.container.textContent ?? "";
	expect(text).toContain("500");
	expect(text).toContain("31ms");
	// the real cause is on top
	expect(view.getByRole("alert").textContent).toContain("db_insert_1 (db_insert): duplicate key");
	expect(view.getByRole("alert").textContent).toContain("users_email_key");
	// a long body is folded, a short request body is open
	const folds = [...view.container.querySelectorAll("details")];
	const body = folds.find((d) => d.textContent?.includes("Response body"));
	expect(body?.open).toBe(false);
	expect(body?.textContent).toContain("lines)");
	expect(folds.find((d) => d.textContent?.includes("Request body"))?.open).toBe(true);
	// the trace is a block list with keys
	const rows = [...view.getByLabelText("Trace").querySelectorAll("li")].map((li) => li.textContent);
	expect(rows[0]).toContain("entrypoint_1");
	expect(rows[1]).toContain("validate_1");
	expect(rows[2]).toContain("db_insert_1");
	expect(rows[2]).toContain("12ms");
	expect(view.getByLabelText("failed")).toBeTruthy();
	expect(rows[3]).toBe("… 4 more blocks, see get_recording");
	read.mockRestore();
});

test("call_route before it runs shows the request alone", async () => {
	const read = spyOn(agentConversationsService, "resourcePreview").mockResolvedValue({
		current: { method: "GET", path: "/health" },
	});
	const view = show({ name: "call_route", input: { routeId: "r1" } }, true);
	await until(() => expect(view.container.textContent).toContain("GET /health"));
	expect(view.queryByLabelText("Trace")).toBeNull();
	read.mockRestore();
});

test("test runs: pass or fail per case, the failed checks with the values they got, a link to the suite", () => {
	const view = show({
		name: "run_test_suite",
		input: { testSuiteId: "s1" },
		output: {
			runId: "run1",
			status: "failed",
			passedCount: 1,
			failedCount: 1,
			durationMs: 2300,
			suites: [
				{
					testSuiteId: "s1",
					status: "failed",
					durationMs: 2000,
					cases: [
						{ name: "creates a user", status: "passed", statusCode: 201, failedChecks: [] },
						{
							name: "rejects a duplicate",
							status: "failed",
							statusCode: 400,
							failedChecks: ["Expected Body(success) to false, got: (property not found: success)"],
						},
					],
				},
			],
		},
		status: "done",
	});
	const text = view.container.textContent ?? "";
	expect(text).toContain("1 passed");
	expect(text).toContain("1 failed");
	expect(text).toContain("2s");
	expect(view.getAllByLabelText("passed")).toHaveLength(1);
	expect(view.getAllByLabelText("failed")).toHaveLength(1);
	expect(text).toContain("all checks passed");
	expect(text).toContain("Expected Body(success) to false, got: (property not found: success)");
	expect(view.getByText("Test suite")).toBeTruthy();
});

test("get_test_runs lists several runs", () => {
	const run = (runId: string, status: string) => ({
		runId,
		status,
		passedCount: 1,
		failedCount: 0,
		suites: [],
	});
	const view = show({
		name: "get_test_runs",
		input: {},
		output: [run("a", "passed"), run("b", "failed")],
		status: "done",
	});
	expect(view.container.textContent).toContain("passed");
	expect(view.container.textContent).toContain("failed");
});

test("list and get results are compact tables and field lists", () => {
	const rows = Array.from({ length: 25 }, (_, i) => ({
		id: `r${i}`,
		name: `Route ${i}`,
		method: "GET",
		path: `/r${i}`,
	}));
	const view = show({
		name: "list_routes",
		input: {},
		output: { items: rows, page: 1, hasNext: false },
		status: "done",
	});
	expect(view.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
		"name",
		"method",
		"path",
		"id",
	]);
	// 20 rows and the rest behind a button
	expect(view.container.querySelectorAll("tbody tr")).toHaveLength(20);
	fireEvent.click(view.getByRole("button", { name: "Show all 25" }));
	expect(view.container.querySelectorAll("tbody tr")).toHaveLength(25);
	expect(view.container.textContent).toContain("hasNext");
});

test("a tool without a preview shows Raw alone, no tabs", () => {
	const view = show({
		name: "search_docs",
		input: { query: "x" },
		output: "some text answer",
		status: "done",
	});
	expect(view.queryByRole("tablist")).toBeNull();
	expect([...view.container.querySelectorAll("pre")].map((p) => p.textContent)).toEqual([
		JSON.stringify({ query: "x" }, null, 2),
		"some text answer",
	]);
});

test("Raw is the same JSON the row always showed, error included; the error stays on top of Preview", () => {
	const view = show({
		name: "call_route",
		input: { routeId: "r1" },
		error: "route is not active",
		status: "error",
	});
	expect(view.getByRole("alert").textContent).toBe("route is not active");
	fireEvent.click(view.getByRole("tab", { name: "Raw" }));
	expect([...view.container.querySelectorAll("pre")].map((p) => p.textContent)).toEqual([
		JSON.stringify({ routeId: "r1" }, null, 2),
		"route is not active",
	]);
	fireEvent.click(view.getByRole("tab", { name: "Preview" }));
	expect(view.getByRole("alert").textContent).toBe("route is not active");
});
