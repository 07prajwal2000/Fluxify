import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// the canvas is React Flow, which happy-dom cannot lay out
mock.module("./OverlayCanvas", () => ({ OverlayCanvas: () => <div data-testid="canvas" /> }));

// The playground itself is covered in packages/components; here only what the
// host hands it matters, so it is swapped for a stub that exposes its props.
type StubProps = {
	route: { path: string; method: string };
	initialState?: {
		queryRows?: { key: string; value: string }[];
		headerRows?: { key: string; value: string }[];
		requestBody?: { raw: string };
	};
};
let stub: StubProps | undefined;
const actual = await import("@fluxify/components");
mock.module("@fluxify/components", () => ({
	...actual,
	ApiPlayground: (props: StubProps) => {
		stub = props;
		return <div data-testid="playground" />;
	},
}));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { CanvasPlaygroundProvider } = await import("@/components/canvas/PlaygroundContext");
const { RecordedRunViewer } = await import("./RecordedRunViewer");
const { RouteApiPlayground } = await import("@/components/RouteApiPlayground");
const { SandboxPlayground } = await import("@/components/sandboxes/SandboxPlayground");
const { RunPayloadModal } = await import("@/components/workflows/WorkflowRunModal");
const { replayOf } = await import("./replay");
const { routesService } = await import("@/services/routes");
const { publicSettingsService } = await import("@/services/publicSettings");
const { projectSettingsKeysService } = await import("@/services/projectSettingsKeys");
const { projectDevTokenService } = await import("@/services/projectDevToken");
const { recordingsService } = await import("@/services/recordings");
const { sandboxesService } = await import("@/services/sandboxes");

afterEach(() => {
	cleanup();
	stub = undefined;
});
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

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

const REQUEST = {
	method: "POST",
	url: "http://api.test/orders/7",
	path: "/orders/7",
	host: "api.test",
	query: { tag: "a" },
	params: { id: "7" },
	headers: { "content-type": "application/json", "x-trace": "t1" },
	cookies: {},
	body: { qty: 3 },
};

const entrySpan = (input: unknown) => ({
	seq: 0,
	parentSeq: null,
	blockId: "entry",
	blockType: "entrypoint",
	blockName: null,
	customBlockId: null,
	middleware: null,
	startedAt: "2026-01-01T00:00:00.000Z",
	endedAt: "2026-01-01T00:00:00.004Z",
	outcome: "success",
	branch: null,
	error: null,
	input,
	output: null,
	truncated: false,
});

const runOf = (input: unknown) => ({
	id: "run1",
	outcome: "success",
	statusCode: 200,
	startedAt: "2026-01-01T00:00:00.000Z",
	endedAt: "2026-01-01T00:00:00.010Z",
	durationMs: 10,
	spanCount: 1,
	truncated: false,
	droppedSpans: 0,
	parentRunId: null,
	routeVersion: null,
	workflowVersion: null,
	versionId: null,
	versionNumber: null,
	parentSeq: null,
	childRuns: [],
	spans: [entrySpan(input)],
});

function renderViewer(
	type: "route" | "workflow" | "sandbox",
	input: unknown,
	onReplay = mock(() => {}),
) {
	const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
	client.setQueryData(["recordings", "p1", type, "t1", "detail", "run1"], runOf(input));
	client.setQueryData(["custom-blocks", "p1"], []);
	const view = render(
		<QueryClientProvider client={client}>
			<RecordedRunViewer
				projectId="p1"
				target={{ type, id: "t1" }}
				runId="run1"
				onBack={() => {}}
				onReplay={onReplay}
			/>
		</QueryClientProvider>,
	);
	return { view, onReplay };
}

const replayButton = (view: ReturnType<typeof render>) =>
	view.queryByRole("button", { name: /Replay/ });

test("a route run offers Replay with its recorded request", () => {
	const { view, onReplay } = renderViewer("route", REQUEST);
	fireEvent.click(replayButton(view) as HTMLElement);
	expect(onReplay).toHaveBeenCalledTimes(1);
	const [replay] = onReplay.mock.calls[0] as unknown as [
		{ kind: string; method: string; state: { queryRows: { key: string; value: string }[] } },
	];
	expect(replay.kind).toBe("request");
	expect(replay.method).toBe("POST");
	expect(replay.state.queryRows.map((r) => [r.key, r.value])).toEqual([["tag", "a"]]);
});

test("a workflow run offers Replay with its payload", () => {
	const { view, onReplay } = renderViewer("workflow", {
		trigger: { kind: "workflow", source: "manual" },
		input: { customerId: "c1" },
		events: [],
	});
	fireEvent.click(replayButton(view) as HTMLElement);
	expect(onReplay).toHaveBeenCalledWith({ kind: "payload", payload: { customerId: "c1" } });
});

test("a sandbox run has Replay, and no Open in sandbox", () => {
	const { view } = renderViewer("sandbox", { ...REQUEST, path: "/_sandbox/t1/orders/7" });
	expect(replayButton(view)).not.toBeNull();
	expect(view.container.textContent).not.toContain("Open in sandbox");
});

test("a run with no recorded input has no Replay", () => {
	const { view } = renderViewer("route", null);
	expect(replayButton(view)).toBeNull();
});

test("the route playground starts from the replayed request, not the cached one", async () => {
	spyOn(routesService, "getById").mockResolvedValue({
		id: "r1",
		name: "Orders",
		method: "post",
		path: "/orders/:id",
		projectId: "p1",
	} as never);
	spyOn(publicSettingsService, "get").mockResolvedValue({
		license: { status: "community" },
	} as never);
	spyOn(projectSettingsKeysService, "getAll").mockResolvedValue({} as never);
	spyOn(projectDevTokenService, "get").mockResolvedValue({ token: "t" } as never);
	spyOn(sandboxesService, "devWorkerOnline").mockResolvedValue(true);
	const replay = replayOf(runOf(REQUEST).spans as never);
	if (replay?.kind !== "request") throw new Error("expected a request replay");
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<RouteApiPlayground routeId="r1" enableCache replay={replay.state} />
		</QueryClientProvider>,
	);
	await until(() => {
		if (!stub) throw new Error("not mounted");
	});
	expect(stub?.initialState?.queryRows?.map((r) => [r.key, r.value])).toEqual([["tag", "a"]]);
	expect(stub?.initialState?.headerRows?.map((r) => [r.key, r.value])).toContainEqual([
		"x-trace",
		"t1",
	]);
	expect(JSON.parse(stub?.initialState?.requestBody?.raw ?? "")).toEqual({ qty: 3 });
});

test("the sandbox playground starts on the replayed method and path", async () => {
	spyOn(publicSettingsService, "get").mockResolvedValue({
		license: { status: "community" },
	} as never);
	spyOn(projectSettingsKeysService, "getAll").mockResolvedValue({} as never);
	spyOn(projectDevTokenService, "get").mockResolvedValue({ token: "t" } as never);
	spyOn(recordingsService, "getRuns").mockResolvedValue({ data: [] } as never);
	const replay = replayOf(runOf({ ...REQUEST, path: "/_sandbox/sb1/orders/7" }).spans as never);
	if (replay?.kind !== "request") throw new Error("expected a request replay");
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<CanvasPlaygroundProvider>
				<SandboxPlayground
					projectId="p1"
					sandboxId="sb1"
					online
					onOpenRun={() => {}}
					replay={replay}
				/>
			</CanvasPlaygroundProvider>
		</QueryClientProvider>,
	);
	await until(() => {
		if (!stub) throw new Error("not mounted");
	});
	expect(stub?.route).toEqual({ path: "/orders/7", method: "POST" });
	expect(JSON.parse(stub?.initialState?.requestBody?.raw ?? "")).toEqual({ qty: 3 });
});

test("the Run form opens with the replayed payload in it", () => {
	const view = render(
		<RunPayloadModal
			heading="Run workflow"
			name="Orders"
			isOpen
			onOpenChange={() => {}}
			run={async () => ({ id: "j1" })}
			initialPayload={{ customerId: "c1" }}
		/>,
	);
	const box = document.body.querySelector("textarea") as HTMLTextAreaElement;
	expect(JSON.parse(box.value)).toEqual({ customerId: "c1" });
	view.unmount();

	render(
		<RunPayloadModal
			heading="Run workflow"
			name="Orders"
			isOpen
			onOpenChange={() => {}}
			run={async () => ({ id: "j1" })}
			initialPayload="plain text"
		/>,
	);
	expect((document.body.querySelector("textarea") as HTMLTextAreaElement).value).toBe("plain text");
});
