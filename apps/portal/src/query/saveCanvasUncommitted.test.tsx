import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, renderHook } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { routesService } = await import("@/services/routes");
const { workflowsService } = await import("@/services/workflows");
const { routesQuery } = await import("./routesQuery");
const { workflowsQuery } = await import("./workflowsQuery");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const PAYLOAD = { actionsToPerform: { blocks: [], edges: [] }, changes: { blocks: [], edges: [] } };

function setup() {
	const client = new QueryClient();
	const invalidate = spyOn(client, "invalidateQueries");
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	return { invalidate, wrapper };
}

const keys = (invalidate: ReturnType<typeof setup>["invalidate"]) =>
	invalidate.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);

test("saving a route's canvas refreshes what the Commit button reads", async () => {
	spyOn(routesService, "saveCanvasItems").mockResolvedValue({} as never);
	const { invalidate, wrapper } = setup();
	const { result } = renderHook(() => routesQuery.saveCanvas.mutation("r1"), { wrapper });
	await act(() => result.current.mutateAsync(PAYLOAD));
	expect(keys(invalidate)).toContainEqual(["routes", "r1", "by-id"]);
	expect(keys(invalidate)).toContainEqual(["routes", "r1", "canvas-items"]);
});

test("and a workflow's", async () => {
	spyOn(workflowsService, "saveCanvasItems").mockResolvedValue({} as never);
	const { invalidate, wrapper } = setup();
	const { result } = renderHook(() => workflowsQuery.saveCanvas.mutation("w1"), { wrapper });
	await act(() => result.current.mutateAsync(PAYLOAD));
	expect(keys(invalidate)).toContainEqual(["workflows", "w1", "by-id"]);
	expect(keys(invalidate)).toContainEqual(["workflows", "w1", "canvas-items"]);
});
