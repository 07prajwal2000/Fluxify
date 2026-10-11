import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });

// The playground itself is covered in packages/components; here only what the
// route hands it matters, so it is swapped for a stub that exposes its props.
type StubProps = {
	baseUrl?: string;
	urlNote?: string;
	onSend: (request: Record<string, unknown>) => Promise<unknown>;
};
let stub: StubProps | undefined;
const actual = await import("@fluxify/components");
mock.module("@fluxify/components", () => ({
	...actual,
	ApiPlayground: (props: StubProps) => {
		stub = props;
		return <div data-testid="playground">{props.baseUrl}</div>;
	},
}));

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { RouteApiPlayground } = await import("./RouteApiPlayground");
const { routesService } = await import("@/services/routes");
const { publicSettingsService } = await import("@/services/publicSettings");
const { projectSettingsKeysService } = await import("@/services/projectSettingsKeys");
const { projectDevTokenService } = await import("@/services/projectDevToken");
const { sandboxesService } = await import("@/services/sandboxes");
const { DEV_TOKEN_HEADER, DEV_WORKER_MESSAGE } = await import("./sandboxes/sandboxRequest");

afterEach(() => {
	cleanup();
	stub = undefined;
});
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

const TOKEN = "fxd_super_secret_value";

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

function mount(online = true, devWorkerUrl?: string, subdomain?: string) {
	spyOn(routesService, "getById").mockResolvedValue({
		id: "r1",
		name: "Orders",
		method: "post",
		path: "/orders/:id",
		projectId: "p1",
	} as never);
	spyOn(publicSettingsService, "get").mockResolvedValue({
		license: { status: "community" },
		devWorkerUrl,
		hosting: { baseDomain: "example.test" },
	} as never);
	spyOn(projectSettingsKeysService, "getAll").mockResolvedValue(
		(subdomain ? { "settings.routing.subdomain": subdomain } : {}) as never,
	);
	spyOn(projectDevTokenService, "get").mockResolvedValue({ token: TOKEN } as never);
	spyOn(sandboxesService, "devWorkerOnline").mockResolvedValue(online);
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<RouteApiPlayground routeId="r1" />
		</QueryClientProvider>,
	);
}

test("the preview shows the project's subdomain; the request goes to DEV_WORKER_URL/_/dev with the token header, never rendered", async () => {
	const view = mount(true, "http://localhost:5602/", "billing");
	const shown = "http://billing.example.test:5601";
	await until(() => {
		if (stub?.baseUrl !== `${shown}/_/dev`) throw new Error("not mounted");
	});
	expect(stub?.urlNote).toContain("subdomain is not needed");
	await until(() => expect(projectDevTokenService.get).toHaveBeenCalled());
	await until(() => expect(sandboxesService.devWorkerOnline).toHaveBeenCalled());

	const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
		new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }),
	);
	await until(async () => {
		// the token arrives after the first paint
		await act(async () => {
			await stub?.onSend({
				method: "POST",
				url: `${shown}/_/dev/orders/7`,
				path: "/orders/7",
				pathParams: {},
				query: {},
				headers: {},
				body: '{"a":1}',
			});
		});
		expect(fetchSpy).toHaveBeenCalled();
	});

	const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
	expect(url).toBe("http://localhost:5602/_/dev/orders/7");
	expect((init.headers as Headers).get(DEV_TOKEN_HEADER)).toBe(TOKEN);
	expect(view.container.textContent).not.toContain(TOKEN);
});

test("without DEV_WORKER_URL it falls back to the project's API address", async () => {
	mount(true, undefined);
	await until(() => {
		if (!stub?.baseUrl?.endsWith("/_/dev")) throw new Error("not mounted");
	});
	expect(stub?.baseUrl).toBe(`${window.location.origin}/_/dev`);
});

test("no development worker: the message, and no way to send", async () => {
	const view = mount(false, "http://localhost:5602");
	await until(() => expect(view.container.textContent).toContain(DEV_WORKER_MESSAGE));
	expect(view.queryByTestId("playground")).toBeNull();
});
