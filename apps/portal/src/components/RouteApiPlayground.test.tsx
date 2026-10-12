import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

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

// The recording link routes with the router, so `Link` is stubbed to keep the
// path and query the router would resolve, the base path aside.
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	Link: ({
		to,
		params,
		search,
		children,
		...rest
	}: {
		to: string;
		params?: Record<string, string>;
		search?: Record<string, string>;
		children: ReactNode;
	}) => {
		const path = Object.entries(params ?? {}).reduce(
			(url, [key, value]) => url.replace(`$${key}`, value),
			to,
		);
		const query = new URLSearchParams(search ?? {}).toString();
		return (
			<a href={query ? `${path}?${query}` : path} {...rest}>
				{children}
			</a>
		);
	},
}));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { RouteApiPlayground } = await import("./RouteApiPlayground");
const { routesService } = await import("@/services/routes");
const { publicSettingsService } = await import("@/services/publicSettings");
const { projectSettingsKeysService } = await import("@/services/projectSettingsKeys");
const { projectDevTokenService } = await import("@/services/projectDevToken");
const { recordingsService } = await import("@/services/recordings");
const { sandboxesService } = await import("@/services/sandboxes");
const { CanvasPlaygroundProvider, useOptionalCanvasPlayground } = await import(
	"@/components/canvas/PlaygroundContext"
);
const { DEV_TOKEN_HEADER, DEV_WORKER_MESSAGE } = await import("./sandboxes/sandboxRequest");

/** The canvas's own playground modal, observed so a test can see it close. */
function CanvasPlaygroundProbe() {
	const playground = useOptionalCanvasPlayground();
	return (
		<>
			<span data-testid="canvas-playground">{playground?.isOpen ? "open" : "closed"}</span>
			<button type="button" onClick={() => playground?.open()}>
				Open the canvas playground
			</button>
		</>
	);
}

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

function mount(
	online = true,
	devWorkerUrl?: string,
	subdomain?: string,
	devRecordExecution = false,
	onOpenRecording?: () => void,
) {
	spyOn(routesService, "getById").mockResolvedValue({
		id: "r1",
		name: "Orders",
		method: "post",
		path: "/orders/:id",
		projectId: "p1",
		recordExecution: false,
		devRecordExecution,
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
			<CanvasPlaygroundProvider>
				<CanvasPlaygroundProbe />
				<RouteApiPlayground routeId="r1" onOpenRecording={onOpenRecording} />
			</CanvasPlaygroundProvider>
		</QueryClientProvider>,
	);
}

test("a project with a subdomain is called on its subdomain even with DEV_WORKER_URL set (#742); the token header is sent, never rendered", async () => {
	const view = mount(true, "http://localhost:5602/", "billing");
	const shown = "http://billing.example.test:5601";
	await until(() => {
		if (stub?.baseUrl !== `${shown}/_/dev`) throw new Error("not mounted");
	});
	expect(stub?.urlNote).toContain("on that subdomain only");
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
	// DEV_WORKER_URL would be a bare host, which a subdomain project refuses
	expect(url).toBe("http://billing.example.test:5601/_/dev/orders/7");
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

test("a development call shows its recording while development recording is on (#740)", async () => {
	let recorded = false;
	spyOn(recordingsService, "getRuns").mockImplementation((async () => ({
		data: recorded ? [{ id: "dev-run-1" }] : [],
		pagination: { page: 1, perPage: 20, totalPages: 0, hasNext: false },
	})) as never);
	const onOpenRecording = mock(() => undefined);
	const view = mount(true, undefined, undefined, true, onOpenRecording);
	// the canvas's own playground modal is what hosts it there
	fireEvent.click(view.getByText("Open the canvas playground"));
	expect(view.getByTestId("canvas-playground").textContent).toBe("open");
	await until(() => {
		if (!stub?.baseUrl?.endsWith("/_/dev")) throw new Error("not mounted");
	});

	// the call is recorded, so a run the list did not hold before now turns up
	const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => {
		recorded = true;
		return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
	}) as never);
	const request = {
		method: "POST",
		url: `${window.location.origin}/_/dev/orders/7`,
		path: "/orders/7",
		pathParams: {},
		query: {},
		headers: {},
		body: "{}",
	};
	// the token arrives after the first paint, so keep sending until the call goes out
	for (let attempt = 0; attempt < 40 && fetchSpy.mock.calls.length === 0; attempt++) {
		await act(async () => {
			await stub?.onSend(request);
		});
		await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
	}
	expect(fetchSpy).toHaveBeenCalled();

	const link = await until(() => view.getByText("Open recording"), 5000);
	expect(view.container.textContent).toContain("This call was recorded.");
	// a run is a page: the link opens the executions page on it
	expect(link.getAttribute("href")).toBe("/p1/canvas/r1/executions?open=dev-run-1");
	// and the modal that hosted the playground gets to close itself
	fireEvent.click(link);
	expect(onOpenRecording).toHaveBeenCalled();
	// the canvas's own playground modal closes with it, the way a sandbox's does
	expect(view.getByTestId("canvas-playground").textContent).toBe("closed");
});

test("a development call keeps no recording link while development recording is off", async () => {
	spyOn(recordingsService, "getRuns").mockResolvedValue({ data: [] } as never);
	const view = mount(true, undefined, undefined, false);
	await until(() => {
		if (!stub?.baseUrl?.endsWith("/_/dev")) throw new Error("not mounted");
	});
	const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
		new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
	);
	const request = {
		method: "POST",
		url: `${window.location.origin}/_/dev/orders/7`,
		path: "/orders/7",
		pathParams: {},
		query: {},
		headers: {},
		body: "{}",
	};
	for (let attempt = 0; attempt < 40 && fetchSpy.mock.calls.length === 0; attempt++) {
		await act(async () => {
			await stub?.onSend(request);
		});
		await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
	}
	expect(fetchSpy).toHaveBeenCalled();
	expect(recordingsService.getRuns).not.toHaveBeenCalled();
	expect(view.queryByText("Open recording")).toBeNull();
});
