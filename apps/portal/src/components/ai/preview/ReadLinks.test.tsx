import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ToolPart } from "../agentMessages";

GlobalRegistrator.register();
mock.module("@tanstack/react-router", () => ({
	useParams: () => ({ projectId: "p1" }),
	Link: ({ to, children, search: _s, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ToolBody } = await import("./ToolBody");

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

test("get_* by id has an Open link to the resource; app config opens on its key", () => {
	const mw = show({
		name: "get_middleware",
		input: { middlewareId: "m1" },
		output: { id: "m1", name: "auth", blocks: [] },
		status: "done",
	});
	expect(mw.container.querySelector('a[href="/p1/middlewares/m1"]')).not.toBeNull();
	cleanup();
	const cfg = show({
		name: "get_app_config",
		input: { appConfigId: 7 },
		output: { id: 7, keyName: "STRIPE_KEY", value: "x" },
		status: "done",
	});
	expect(cfg.container.querySelector('a[href="/p1/app-config"]')).not.toBeNull();
});

test("the agent's get and list (one tool, a type) link to the resources too", () => {
	const one = show({
		name: "get",
		input: { type: "integration", id: "i1" },
		output: { id: "i1", name: "Main DB", variant: "postgres" },
		status: "done",
	});
	expect(one.container.querySelector('a[href="/p1/integrations/i1"]')).not.toBeNull();
	cleanup();
	const many = show({
		name: "list",
		input: { types: ["routes", "middlewares"] },
		output: {
			routes: { items: [{ id: "r1", name: "Users", method: "GET", path: "/users" }], page: 1 },
			middlewares: [{ id: "m1", name: "auth" }],
		},
		status: "done",
	});
	expect(many.container.querySelector('a[href="/p1/canvas/r1"]')).not.toBeNull();
	expect(many.container.querySelector('a[href="/p1/middlewares/m1"]')).not.toBeNull();
});

test("list_recordings: a line per run that opens it, no raw id", () => {
	const view = show({
		name: "list_recordings",
		input: { kind: "route", targetId: "r1" },
		output: {
			items: [
				{
					id: "0199aaaa-1111-7000-8000-000000000001",
					startedAt: "2026-10-10T10:00:00Z",
					durationMs: 42,
					outcome: "failure",
					statusCode: 500,
					testLabel: "rejects a duplicate",
				},
			],
			page: 1,
			hasNext: true,
		},
		status: "done",
	});
	const text = view.container.textContent ?? "";
	expect(text).toContain("failure");
	expect(text).toContain("500");
	expect(text).toContain("42ms");
	expect(text).toContain("rejects a duplicate");
	expect(text).not.toContain("0199aaaa");
	expect(text).toContain("More runs on the next page");
	const open = view.getByText("Open recording").closest("a");
	expect(open?.getAttribute("href")).toBe("/p1/canvas/r1/executions");
});

test("get_recording: a summary and an Open button, the spans stay in Raw", () => {
	const view = show({
		name: "get_recording",
		input: { kind: "workflow", targetId: "w1", runId: "run9" },
		output: {
			id: "run9",
			outcome: "success",
			durationMs: 1500,
			startedAt: "2026-10-10T10:00:00Z",
			spans: [
				{ seq: 1, blockKey: "entrypoint_1" },
				{ seq: 2, blockKey: "response_1" },
			],
		},
		status: "done",
	});
	expect(view.container.querySelector("table")).toBeNull();
	expect(view.container.textContent).toContain("2 blocks ran");
	expect(view.container.textContent).toContain("1.5s");
	expect(view.getByText("Open recording").closest("a")?.getAttribute("href")).toBe(
		"/p1/workflow-canvas/w1/executions",
	);
});

test("a test case with a recorded run has an Open recording button", async () => {
	const { testSuitesService } = await import("@/services/testSuites");
	const read = spyOn(testSuitesService, "getById").mockResolvedValue({
		routeId: "r9",
		workflowId: null,
	} as never);
	const view = show({
		name: "get_test_runs",
		input: { testSuiteId: "s1" },
		output: [
			{
				runId: "a",
				status: "passed",
				suites: [
					{
						testSuiteId: "s1",
						status: "passed",
						cases: [
							{ name: "with a trace", status: "passed", traceRunId: "t1" },
							{ name: "without", status: "passed" },
						],
					},
				],
			},
		],
		status: "done",
	});
	const links = await until(() => {
		const l = view.getAllByText("Open recording");
		expect(l).toHaveLength(1);
		return l;
	});
	expect(links[0].closest("a")?.getAttribute("href")).toBe("/p1/canvas/r9/executions");
	read.mockRestore();
});
