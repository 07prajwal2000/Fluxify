import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// The playground itself is covered in packages/components; here only what the
// sandbox hands it matters, so it is swapped for a stub that exposes `onSend`.
type StubProps = {
	baseUrl?: string;
	editableRequest?: boolean;
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
const { CanvasPlaygroundProvider } = await import("@/components/canvas/PlaygroundContext");
const { publicSettingsService } = await import("@/services/publicSettings");
const { projectSettingsKeysService } = await import("@/services/projectSettingsKeys");
const { projectDevTokenService } = await import("@/services/projectDevToken");
const { recordingsService } = await import("@/services/recordings");
const { SandboxPlayground } = await import("./SandboxPlayground");
const { DEV_TOKEN_HEADER, DEV_WORKER_MESSAGE, sandboxBaseUrl, sendSandboxRequest } = await import(
	"./sandboxRequest"
);

afterEach(() => {
	cleanup();
	stub = undefined;
});
afterAll(() => GlobalRegistrator.unregister());

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

function mount(online = true, devWorkerUrl?: string) {
	spyOn(publicSettingsService, "get").mockResolvedValue({
		license: { status: "community" },
		devWorkerUrl,
	} as never);
	spyOn(projectSettingsKeysService, "getAll").mockResolvedValue({} as never);
	spyOn(projectDevTokenService, "get").mockResolvedValue({ token: TOKEN } as never);
	spyOn(recordingsService, "getRuns").mockResolvedValue({ data: [] } as never);
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<CanvasPlaygroundProvider>
				<SandboxPlayground projectId="p1" sandboxId="sbx1" online={online} onOpenRun={() => {}} />
			</CanvasPlaygroundProvider>
		</QueryClientProvider>,
	);
}

beforeEach(() => mock.restore());

test("the base URL is DEV_WORKER_URL plus /_sandbox/<id>", () => {
	expect(sandboxBaseUrl("http://localhost:5602/", "sbx1")).toBe(
		"http://localhost:5602/_sandbox/sbx1",
	);
});

test("a request goes to the dev worker with the token header, which is never rendered", async () => {
	const view = mount(true, "http://localhost:5602");
	await until(() => {
		if (!stub || !stub.baseUrl?.includes("localhost:5602")) throw new Error("not mounted");
	});
	// the dev token is fetched, not painted
	await until(() => expect(projectDevTokenService.get).toHaveBeenCalled());
	expect(stub?.baseUrl).toBe("http://localhost:5602/_sandbox/sbx1");
	expect(stub?.editableRequest).toBe(true);

	const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
		new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }),
	);
	await act(async () => {
		await stub?.onSend({
			method: "POST",
			url: "http://localhost:5602/_sandbox/sbx1/orders/7?x=1",
			path: "/orders/7",
			pathParams: {},
			query: { x: "1" },
			headers: { "Content-Type": "application/json" },
			body: '{"a":1}',
		});
	});

	const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
	expect(url).toBe("http://localhost:5602/_sandbox/sbx1/orders/7?x=1");
	expect(init.method).toBe("POST");
	expect((init.headers as Headers).get(DEV_TOKEN_HEADER)).toBe(TOKEN);
	expect(view.container.textContent).not.toContain(TOKEN);
});

test("without DEV_WORKER_URL it falls back to the project's API address", async () => {
	mount(true, undefined);
	await until(() => {
		if (!stub?.baseUrl?.endsWith("/_sandbox/sbx1")) throw new Error("not mounted");
	});
	expect(stub?.baseUrl).toBe(`${window.location.origin}/_sandbox/sbx1`);
});

test("no development worker: the message, and no way to send", async () => {
	const view = mount(false, "http://localhost:5602");
	await until(() => expect(view.container.textContent).toContain(DEV_WORKER_MESSAGE));
	expect(stub).toBeUndefined();
});

test("an unreachable worker comes back as a response, not a crash", async () => {
	spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
	const response = await sendSandboxRequest(
		{
			method: "GET",
			url: "http://localhost:5602/_sandbox/sbx1/",
			path: "/",
			pathParams: {},
			query: {},
			headers: {},
		},
		TOKEN,
	);
	expect(response.status).toBe(0);
	expect(response.body).toContain("localhost:5602");
	expect(response.body).not.toContain(TOKEN);
});
