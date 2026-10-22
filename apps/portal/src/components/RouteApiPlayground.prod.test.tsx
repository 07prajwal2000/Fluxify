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
	useBlocker: () => {},
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
const { sandboxesService } = await import("@/services/sandboxes");
const { recordingsService } = await import("@/services/recordings");
const { DEV_TOKEN_HEADER, DEV_ROUTE_PREFIX } = await import("./sandboxes/sandboxRequest");

beforeEach(() => mock.restore());
afterEach(() => {
	cleanup();
	stub = undefined;
});
afterAll(() => GlobalRegistrator.unregister());

const TOKEN = "fxd_test_value";

async function until<T>(check: () => T, timeout = 4000): Promise<T> {
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

function mount(recordExecution: boolean, prodVersionId: string | null) {
	spyOn(routesService, "getById").mockResolvedValue({
		id: "r1",
		name: "Orders",
		method: "post",
		path: "/orders/:id",
		projectId: "p1",
		prodVersionId,
		prodVersionNumber: prodVersionId ? 2 : null,
		recordExecution,
		devRecordExecution: false,
	} as never);
	spyOn(publicSettingsService, "get").mockResolvedValue({
		license: { status: "community" },
		hosting: { baseDomain: "example.test" },
	} as never);
	spyOn(projectSettingsKeysService, "getAll").mockResolvedValue({} as never);
	spyOn(projectDevTokenService, "get").mockResolvedValue({ token: TOKEN } as never);
	spyOn(sandboxesService, "devWorkerOnline").mockResolvedValue(true);
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<RouteApiPlayground routeId="r1" />
		</QueryClientProvider>,
	);
}

const checkbox = () => document.querySelector("input[type=checkbox]") as HTMLInputElement;

async function chooseProduction() {
	await until(() => checkbox());
	fireEvent.click(checkbox());
	const proceed = await until(() =>
		[...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Continue"),
	);
	await act(async () => {
		if (proceed) fireEvent.click(proceed);
	});
}

test("it opens on Development, with no production confirm", async () => {
	mount(false, "prod-version");
	await until(() => {
		if (!stub?.baseUrl?.endsWith(DEV_ROUTE_PREFIX)) throw new Error("not mounted");
	});
	expect(stub?.baseUrl?.endsWith(DEV_ROUTE_PREFIX)).toBe(true);
	expect(document.body.textContent).not.toContain("real data, real side effects");
});

test("production is disabled, with the reason, when nothing is promoted", async () => {
	mount(false, null);
	await until(() => {
		if (!checkbox()) throw new Error("no checkbox yet");
	});
	expect(checkbox().disabled).toBe(true);
	expect(document.body.textContent).toContain("Not promoted yet");
});

test("production calls the public address, with no /_/dev and no token header", async () => {
	mount(false, "prod-version");
	await until(() => {
		if (!stub?.baseUrl?.endsWith(DEV_ROUTE_PREFIX)) throw new Error("not mounted");
	});
	await chooseProduction();
	await until(() => document.body.textContent?.includes("real data, real side effects"));

	// after confirming, the base URL is the project's public address
	await until(() => expect(stub?.baseUrl).toBe("http://localhost:5601"));
	expect(stub?.baseUrl).not.toContain(DEV_ROUTE_PREFIX);

	const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
		new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }),
	);
	await act(async () => {
		await stub?.onSend({
			method: "GET",
			url: "http://localhost:5601/orders/7",
			path: "/orders/7",
			pathParams: {},
			query: {},
			headers: {},
			body: undefined,
		});
	});
	const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
	expect(url).toBe("http://localhost:5601/orders/7");
	expect((init.headers as Headers).get(DEV_TOKEN_HEADER)).toBeNull();
});

test("the open-recording link appears only while production recording is on", async () => {
	let recorded = false;
	spyOn(recordingsService, "getRuns").mockImplementation((async () => ({
		data: recorded ? [{ id: "run-1" }] : [],
		pagination: { page: 1, perPage: 20, totalPages: 0, hasNext: false },
	})) as never);
	mount(true, "prod-version");
	await until(() => {
		if (!stub?.baseUrl?.endsWith(DEV_ROUTE_PREFIX)) throw new Error("not mounted");
	});
	await chooseProduction();
	await until(() => expect(stub?.baseUrl).toBe("http://localhost:5601"));

	spyOn(globalThis, "fetch").mockImplementation((async () => {
		recorded = true;
		return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
	}) as never);
	await act(async () => {
		await stub?.onSend({
			method: "GET",
			url: "http://localhost:5601/orders/7",
			path: "/orders/7",
			pathParams: {},
			query: {},
			headers: {},
			body: undefined,
		});
	});

	await until(() => {
		if (!document.body.textContent?.includes("Open recording")) throw new Error("no link");
	});
	expect(document.body.textContent).toContain("This call was recorded.");
});
