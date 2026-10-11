import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, renderHook } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { versionsService } = await import("@/services/versions");
const { versionsQuery } = await import("./versionsQuery");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

type Options = {
	queryKey?: unknown[];
	predicate?: (query: { queryKey: unknown[] }) => boolean;
	refetchType?: string;
};

function setup() {
	const client = new QueryClient();
	const invalidate = spyOn(client, "invalidateQueries");
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	const calls = () => invalidate.mock.calls.map((call) => call[0] as Options);
	const keys = () => calls().flatMap((c) => (c.queryKey ? [c.queryKey] : []));
	return { wrapper, calls, keys };
}

test("a checkout reads again everything that shows the restored version", async () => {
	spyOn(versionsService, "checkout").mockResolvedValue({} as never);
	const { wrapper, calls, keys } = setup();
	const { result } = renderHook(() => versionsQuery.checkout.mutation("route", "r1"), { wrapper });
	await act(() => result.current.mutateAsync({ versionId: "v1" }));

	expect(keys()).toEqual(
		expect.arrayContaining([
			["routes", "r1", "versions"],
			["routes", "r1", "by-id"],
			["routes", "r1", "canvas-items"],
			["routes", "list"],
			["middlewares"],
		]),
	);
	// inactive queries too: the canvas page is not open yet, and must not open on the old graph
	expect(calls().every((c) => c.refetchType === "all")).toBe(true);

	// and this route's last compile result, not another's
	const compile = calls().find((c) => c.predicate);
	expect(compile?.predicate?.({ queryKey: ["system-logs", "p1", "compile", "route", "r1"] })).toBe(
		true,
	);
	expect(compile?.predicate?.({ queryKey: ["system-logs", "p1", "compile", "route", "r2"] })).toBe(
		false,
	);
});

test("a workflow's checkout refreshes the workflow lists", async () => {
	spyOn(versionsService, "checkout").mockResolvedValue({} as never);
	const { wrapper, keys } = setup();
	const { result } = renderHook(() => versionsQuery.checkout.mutation("workflow", "w1"), {
		wrapper,
	});
	await act(() => result.current.mutateAsync({ versionId: "v1" }));
	expect(keys()).toEqual(
		expect.arrayContaining([
			["workflows", "w1", "canvas-items"],
			["workflows", "list"],
		]),
	);
});

test("a commit moves only the history and the head", async () => {
	spyOn(versionsService, "commit").mockResolvedValue({} as never);
	const { wrapper, keys } = setup();
	const { result } = renderHook(() => versionsQuery.commit.mutation("route", "r1"), { wrapper });
	await act(() => result.current.mutateAsync({ title: "First" }));
	expect(keys()).toEqual([
		["routes", "r1", "versions"],
		["routes", "r1", "by-id"],
	]);
});
