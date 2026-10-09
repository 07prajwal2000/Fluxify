import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
mock.module("@tanstack/react-router", () => ({
	useParams: () => ({ projectId: "p1" }),
	Link: ({ to, children, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

const { cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { RunSummary } = await import("./RunSummary");
const { runChanges } = await import("./runChanges");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

type Row = { seq: number; role: string; runId: string; content: unknown };
let seq = 0;
/** An assistant call and its saved result, as two rows of `run`. */
const step = (
	run: string,
	name: string,
	input: unknown,
	output?: unknown,
	error?: string,
): Row[] => {
	const id = `t${seq}`;
	return [
		{
			seq: seq++,
			role: "assistant",
			runId: run,
			content: {
				role: "assistant",
				content: [{ type: "tool-call", toolCallId: id, toolName: name, input }],
			},
		},
		{
			seq: seq++,
			role: "tool",
			runId: run,
			content: {
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: id,
						toolName: name,
						output: error ? { type: "error-text", value: error } : { type: "json", value: output },
					},
				],
			},
		},
	];
};

const rows: Row[] = [
	// an earlier run made the route
	...step("r0", "save_route", { name: "users", path: "/users" }, { id: "route-1" }),
	...step("r1", "get_route", { routeId: "route-1" }, { id: "route-1" }),
	...step("r1", "save_route", { routeId: "route-1", active: true }, { id: "route-1" }),
	...step("r1", "save_workflow", { name: "nightly" }, { id: "wf-1" }),
	...step(
		"r1",
		"edit_canvas",
		{ target: { kind: "workflow", id: "wf-1" }, version: 1, ops: [] },
		{ version: 2 },
	),
	...step("r1", "save_app_config", { keyName: "API_KEY", value: "x" }, { id: 12 }),
	...step("r1", "delete_trigger", { triggerId: "tr-1" }, { deleted: "tr-1" }),
	...step("r1", "save_middleware", { name: "auth" }, undefined, "You need the creator role"),
];

test("changes: created, updated and deleted from the run's successful calls only", () => {
	expect(runChanges(rows as never, "r1")).toEqual([
		// a field-only update keeps the name an earlier run gave it
		{ type: "route", id: "route-1", label: "users", action: "updated" },
		// created, then its canvas edited: still created
		{ type: "workflow", id: "wf-1", label: "nightly", action: "created" },
		{ type: "app_config", id: "12", label: "API_KEY", action: "created" },
		{ type: "trigger", id: "tr-1", label: "trigger tr-1", action: "deleted" },
	]);
});

const usage = {
	steps: 6,
	inputTokens: 12400,
	outputTokens: 830,
	cacheReadTokens: 9000,
	durationMs: 72_000,
};
const view = (run: object) =>
	render(
		<QueryClientProvider client={new QueryClient()}>
			<RunSummary run={run as never} rows={rows as never} />
		</QueryClientProvider>,
	);

test("the card shows steps, tokens, cache read, time and the changes as links", () => {
	const { container } = view({ id: "r1", status: "completed", stopReason: null, usage });
	const text = container.textContent ?? "";
	for (const part of [
		"6Steps",
		"12.4kInput tokens",
		"830Output tokens",
		"9,000Cache read",
		"1m 12sTime",
	])
		expect(text).toContain(part);
	const links = [...container.querySelectorAll("a")].map((a) => [
		a.textContent,
		a.getAttribute("href"),
	]);
	expect(links).toEqual([
		["users", "/p1/canvas/route-1"],
		["nightly", "/p1/workflow-canvas/wf-1"],
		["API_KEY", "/p1/app-config"],
	]);
	// a deleted resource has nothing to open
	expect(text).toContain("Deletedtrigger tr-1");
});

test("no card until the run is completed and has a recorded cost", () => {
	expect(
		view({ id: "r1", status: "waiting_approval", stopReason: null, usage }).container.textContent,
	).toBe("");
	expect(
		view({ id: "r1", status: "completed", stopReason: null, usage: null }).container.textContent,
	).toBe("");
});
