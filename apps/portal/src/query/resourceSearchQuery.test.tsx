import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, renderHook } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { findResourceQuery } = await import("@/query/findResourceQuery");
const { sandboxesService } = await import("@/services/sandboxes");
const { workflowsService } = await import("@/services/workflows");
const { triggersService } = await import("@/services/triggers");
const { middlewaresService } = await import("@/services/middlewares");
const { testSuitesService } = await import("@/services/testSuites");
const { useResourceSearch } = await import("./resourceSearchQuery");

const sandboxes = [
	{ id: "s1", name: "Scratch pad" },
	{ id: "s2", name: "Billing" },
];

beforeEach(() => {
	spyOn(findResourceQuery.search, "useQuery").mockReturnValue({ data: { results: [] } } as never);
	spyOn(workflowsService, "getAll").mockResolvedValue({ data: [] } as never);
	spyOn(triggersService, "getAll").mockResolvedValue({ data: [] } as never);
	spyOn(middlewaresService, "getAll").mockResolvedValue([]);
	spyOn(testSuitesService, "listByProject").mockResolvedValue([]);
	spyOn(sandboxesService, "list").mockResolvedValue(sandboxes as never);
});
afterEach(() => {
	client.clear();
	cleanup();
	mock.restore();
});
afterAll(() => GlobalRegistrator.unregister());

// one client for the whole render: a new one per render would drop the queries
const client = new QueryClient();
const wrapper = ({ children }: { children: React.ReactNode }) => (
	<QueryClientProvider client={client}>{children}</QueryClientProvider>
);

test("a sandbox is found by name and offered as a sandbox mention", async () => {
	const { result } = renderHook(() => useResourceSearch("p1", "scratch"), { wrapper });
	// act flushes the re-render itself; waitFor polled a hook that never re-rendered once other files had run
	await act(() => new Promise((r) => setTimeout(r, 50)));
	expect(result.current.results[0]).toEqual({ type: "sandbox", id: "s1", name: "Scratch pad" });
});

test("an empty term asks for no sandboxes", () => {
	const { result } = renderHook(() => useResourceSearch("p1", " "), { wrapper });
	expect(result.current.results).toEqual([]);
	expect(sandboxesService.list).not.toHaveBeenCalled();
});
