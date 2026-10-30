import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// it links to project settings, which needs a router this test does not have
mock.module("./RouteTelemetryHelp", () => ({ RouteTelemetryHelp: () => null }));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { RouteSettingsModal } = await import("./RouteSettingsModal");
const { routesService } = await import("@/services/routes");
const { integrationService } = await import("@/services/integrations");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

const ROUTE = {
	id: "r1",
	projectId: "p1",
	name: "Chat",
	path: "/chat",
	method: "GET",
	active: true,
	devActive: true,
	timeoutSeconds: 30,
	acceptedContentTypes: [],
	bodyMode: "buffer",
	sseBrokerId: null as string | null,
	paramsSchema: null,
	querySchema: null,
	bodySchema: null,
	tracingEnabled: false,
	recordExecution: false,
	devTracingEnabled: false,
	devRecordExecution: false,
};

const integration = (id: string, name: string, group: string, variant: string) => ({
	id,
	name,
	group,
	variant,
});

function renderSettings(route = ROUTE, readOnly = false) {
	spyOn(routesService, "getById").mockResolvedValue(route as never);
	// a refetch must not reach the network; the seeded lists below are what counts
	spyOn(integrationService, "getAll").mockImplementation((async (_p: string, group: string) =>
		client.getQueryData(["integrations", "p1", group, undefined])) as never);
	const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
	client.setQueryData(["routes", "r1", "by-id"], route);
	client.setQueryData(["project-settings-keys", "p1"], {});
	// Kafka and Memcached cannot carry SSE, so they are not offered
	client.setQueryData(
		["integrations", "p1", "queue", undefined],
		[
			integration("nats-1", "events", "queue", "NATS"),
			integration("kafka-1", "orders", "queue", "Kafka"),
		],
	);
	client.setQueryData(
		["integrations", "p1", "kv", undefined],
		[
			integration("redis-1", "cache", "kv", "Redis"),
			integration("mc-1", "sessions", "kv", "Memcached"),
		],
	);
	return render(
		<QueryClientProvider client={client}>
			<RouteSettingsModal routeId="r1" isOpen onOpenChange={() => {}} readOnly={readOnly} />
		</QueryClientProvider>,
	);
}

const click = (el: Element) =>
	act(async () => {
		fireEvent.click(el);
	});

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

test("Advanced offers the project's NATS and Redis integrations as the SSE broker, and saves the pick", async () => {
	const update = spyOn(routesService, "update").mockResolvedValue({ id: "r1" } as never);
	const view = renderSettings();
	await click(view.getByRole("tab", { name: "Advanced" }));
	expect(view.getByText(/Where events travel when this route calls sse.connect/)).toBeTruthy();

	await click(view.getByRole("button", { name: /SSE broker/ }));
	const options = view.getAllByRole("option").map((o) => o.textContent);
	expect(options).toEqual(["None", "events (NATS)", "cache (Redis)"]);
	await click(view.getByRole("option", { name: "cache (Redis)" }));

	await click(view.getByRole("button", { name: "Save changes" }));
	await settle();
	expect(update.mock.calls[0]?.[1]).toMatchObject({ sseBrokerId: "redis-1" });
});

test("None clears a saved broker", async () => {
	const update = spyOn(routesService, "update").mockResolvedValue({ id: "r1" } as never);
	const view = renderSettings({ ...ROUTE, sseBrokerId: "nats-1" });
	await click(view.getByRole("tab", { name: "Advanced" }));
	await click(view.getByRole("button", { name: /SSE broker/ }));
	await click(view.getByRole("option", { name: "None" }));
	await click(view.getByRole("button", { name: "Save changes" }));
	await settle();
	expect(update.mock.calls[0]?.[1]).toMatchObject({ sseBrokerId: null });
});

test("read-only: the broker cannot be changed", async () => {
	const view = renderSettings({ ...ROUTE, sseBrokerId: "nats-1" }, true);
	await click(view.getByRole("tab", { name: "Advanced" }));
	const trigger = view.getByRole("button", { name: /SSE broker/ });
	expect(trigger.hasAttribute("disabled") || trigger.getAttribute("aria-disabled") === "true").toBe(
		true,
	);
});
