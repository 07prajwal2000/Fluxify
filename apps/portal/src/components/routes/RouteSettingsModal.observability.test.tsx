import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// it links to project settings, which needs a router this test does not have
mock.module("./RouteTelemetryHelp", () => ({ RouteTelemetryHelp: () => null }));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { toast } = await import("@fluxify/components");
const { RouteSettingsModal } = await import("./RouteSettingsModal");
const { routesService } = await import("@/services/routes");
const { PROD_ENABLED_HINT, PROD_RECORDING_HINT } = await import(
	"@/components/settings/ObservabilityTabs"
);

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

const WARNING = "Recording is heavy at scale. Prefer tracing, or open the route in a sandbox.";

const ROUTE = {
	id: "r1",
	projectId: "p1",
	name: "List orders",
	path: "/orders",
	method: "GET",
	active: true,
	devActive: true,
	timeoutSeconds: 30,
	acceptedContentTypes: [],
	paramsSchema: null,
	querySchema: null,
	bodySchema: null,
	tracingEnabled: false,
	recordExecution: false,
	devTracingEnabled: false,
	devRecordExecution: true,
};

function renderSettings() {
	// the query may refetch on mount, so the service answers with the same route
	spyOn(routesService, "getById").mockResolvedValue(ROUTE as never);
	const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
	client.setQueryData(["routes", "r1", "by-id"], ROUTE);
	client.setQueryData(["project-settings-keys", "p1"], {});
	return render(
		<QueryClientProvider client={client}>
			<RouteSettingsModal routeId="r1" isOpen onOpenChange={() => {}} />
		</QueryClientProvider>,
	);
}

function click(el: HTMLElement) {
	return act(async () => {
		fireEvent.click(el);
	});
}

test("development is the default tab; both tabs save their own fields; production recording warns", async () => {
	const update = spyOn(routesService, "update").mockResolvedValue({ id: "r1" } as never);
	const partial = spyOn(routesService, "updatePartial").mockResolvedValue({
		id: "r1",
		warning: WARNING,
	} as never);
	const warn = spyOn(toast, "warning").mockImplementation((() => "") as never);
	const view = renderSettings();
	await click(view.getByRole("tab", { name: "Advanced" }));

	expect(view.getByRole("tab", { name: "Development" }).getAttribute("aria-selected")).toBe("true");
	expect((view.getByRole("checkbox", { name: /Recording/ }) as HTMLInputElement).checked).toBe(
		true,
	);
	expect(view.queryByText(PROD_RECORDING_HINT)).toBeNull();

	// development: recording off
	await click(view.getByRole("checkbox", { name: /Recording/ }));
	// production: recording on, with the hint under it
	await click(view.getByRole("tab", { name: "Production" }));
	expect(view.getByText(PROD_RECORDING_HINT)).toBeTruthy();
	await click(view.getByRole("checkbox", { name: /Recording/ }));

	await click(view.getByRole("button", { name: "Save changes" }));
	await act(() => new Promise((r) => setTimeout(r, 20)));

	// the definition goes to the full update, without the switches
	expect(update).toHaveBeenCalledTimes(1);
	expect(update.mock.calls[0]?.[1]).not.toHaveProperty("tracingEnabled");
	expect(partial).toHaveBeenCalledWith("r1", { devRecordExecution: false, recordExecution: true });
	expect(warn).toHaveBeenCalledWith(WARNING);
});

test("each environment has its own Enabled switch, saved as active and devActive", async () => {
	const update = spyOn(routesService, "update").mockResolvedValue({ id: "r1" } as never);
	const view = renderSettings();
	await click(view.getByRole("tab", { name: "Advanced" }));

	// development: on, as saved; the production hint is not shown here
	expect((view.getByRole("checkbox", { name: /^Enabled/ }) as HTMLInputElement).checked).toBe(true);
	expect(view.queryByText(PROD_ENABLED_HINT)).toBeNull();
	await click(view.getByRole("checkbox", { name: /^Enabled/ }));

	await click(view.getByRole("tab", { name: "Production" }));
	expect(view.getByText(PROD_ENABLED_HINT)).toBeTruthy();
	await click(view.getByRole("checkbox", { name: /^Enabled/ }));

	await click(view.getByRole("button", { name: "Save changes" }));
	await act(() => new Promise((r) => setTimeout(r, 20)));

	expect(update.mock.calls[0]?.[1]).toMatchObject({ active: false, devActive: false });
});
