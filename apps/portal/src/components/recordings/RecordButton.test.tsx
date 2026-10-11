import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { toast } = await import("@fluxify/components");
const { RecordButton } = await import("./RecordingControls");
const { routesService } = await import("@/services/routes");
const { systemLogsService } = await import("@/services/systemLogs");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

test("the Record button changes development only, and says when it applied", async () => {
	const route = {
		id: "r1",
		method: "GET",
		path: "/orders",
		recordExecution: false,
		devRecordExecution: false,
	};
	spyOn(routesService, "getById").mockResolvedValue(route as never);
	const partial = spyOn(routesService, "updatePartial").mockResolvedValue({ id: "r1" } as never);
	// the compile is seen as done on the first look
	let call = 0;
	spyOn(systemLogsService, "list").mockImplementation((async () =>
		call++ === 0 ? [] : [{ updatedAt: "2999-01-01T00:00:00Z" }]) as never);
	const done = spyOn(toast, "success").mockImplementation((() => "") as never);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	client.setQueryData(["routes", "r1", "by-id"], route);
	const view = render(
		<QueryClientProvider client={client}>
			<RecordButton projectId="p1" target={{ type: "route", id: "r1" }} />
		</QueryClientProvider>,
	);
	await act(async () => {
		fireEvent.click(view.getByRole("button", { name: /Record development/ }));
	});
	await act(() => new Promise((r) => setTimeout(r, 1300)));

	expect(partial).toHaveBeenCalledWith("r1", { devRecordExecution: true });
	expect(done).toHaveBeenCalledWith("Development recording turned on");
});
