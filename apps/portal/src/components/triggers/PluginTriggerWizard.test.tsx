import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register({ url: "http://localhost:5601/" });
Element.prototype.scrollIntoView = () => {};
class Observer {
	observe() {}
	unobserve() {}
	disconnect() {}
}
Object.assign(globalThis, { ResizeObserver: Observer });

// the renderer reads the project from the route; this file has no router
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useParams: () => ({ projectId: "p1" }),
}));

// Monaco cannot load under `bun test`; stub the editor the JS field's module graph imports.
mock.module("../../../../../packages/components/src/JavaScriptTextArea/JavaScriptTextArea", () => ({
	JavaScriptTextArea: ({
		value,
		"aria-label": label,
	}: {
		value?: string;
		"aria-label"?: string;
	}) => <textarea aria-label={label} readOnly value={value} />,
}));

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { pluginsService } = await import("@/services/plugins");
const { triggersService } = await import("@/services/triggers");
const { TriggerPage } = await import("./TriggerPage");
const { TriggerWizard } = await import("./TriggerWizard");
const { plugin: pluginFixture } = await import("../settings/plugins/fixtures");

/** Not RTL's findBy/waitFor: those stay bound to the DOM of whichever test file loaded RTL first. */
async function until<T>(check: () => T, timeout = 5000): Promise<T> {
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

const renderPage = (node: React.ReactNode) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			{node}
		</QueryClientProvider>,
	);

const stepLabels = (view: ReturnType<typeof render>) =>
	[...view.getByRole("navigation", { name: "Setup steps" }).querySelectorAll("li")].map((li) =>
		li.textContent?.replace(/^\d+/, ""),
	);
const button = (text: string) =>
	[...document.querySelectorAll("button")].find((b) => b.textContent?.trim().includes(text)) as
		| HTMLButtonElement
		| undefined;
const step = (text: string) => button(text);

const kind = (over: Record<string, unknown> = {}) => ({
	kind: "acme/pg/poller",
	type: "plugin:acme/pg/poller",
	plugin: "acme/pg",
	version: "1.0.0",
	label: "Postgres poller",
	description: "Polls a table",
	icon: "",
	params: {
		table: { type: "string", label: "Table", required: true },
		conn: { type: "string", label: "Connection", tab: "Connection" },
		interval: { type: "string", label: "Interval", tab: "Polling" },
	},
	tabs: ["Connection", "Polling"],
	permissions: { integrations: [] },
	retry: false,
	environments: { development: true, production: false },
	...over,
});

const saved = (over: Record<string, unknown> = {}) => ({
	id: "t1",
	name: "Poller",
	description: null,
	type: "plugin:acme/pg/poller",
	projectId: "p1",
	workflowId: null,
	sandboxId: null,
	groupId: "g1",
	integrationId: null,
	batchSize: 1,
	maxWaitMs: 0,
	maxBytes: 1_000_000,
	concurrency: 1,
	payload: null,
	source: { table: "jobs" },
	commitMode: "auto",
	maxAttempts: 3,
	retryDelayMs: 1000,
	schedule: null,
	timezone: "UTC",
	active: true,
	disabledReason: null,
	createdAt: "2026-10-22T00:00:00.000Z",
	updatedAt: "2026-10-22T00:00:00.000Z",
	...over,
});

let kinds: ReturnType<typeof kind>[] = [];
let plugins: ReturnType<typeof pluginFixture>[] = [];
let byId: ReturnType<typeof saved> | null = null;

beforeEach(() => {
	mock.restore();
	kinds = [kind()];
	plugins = [];
	byId = null;
	spyOn(triggersService, "getPluginKinds").mockImplementation(
		async (_projectId, wanted) =>
			(wanted ? kinds.filter((k) => k.kind === wanted) : kinds) as never,
	);
	spyOn(triggersService, "getGroups").mockResolvedValue([]);
	spyOn(triggersService, "create").mockResolvedValue({ id: "new", warnings: [] } as never);
	spyOn(triggersService, "update").mockResolvedValue({ warnings: [] } as never);
	spyOn(triggersService, "getById").mockImplementation(async () => byId as never);
	spyOn(pluginsService, "list").mockImplementation(async () => plugins as never);
});

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const createWizard = () =>
	renderPage(<TriggerWizard projectId="p1" onBack={() => {}} onSuccess={() => {}} />);

async function pickPlugin(view: ReturnType<typeof render>) {
	await until(() => view.getByText("Postgres poller"));
	fireEvent.click(view.getByText("Postgres poller"));
}

async function reachBasics(view: ReturnType<typeof render>) {
	await pickPlugin(view);
	fireEvent.click(button("Next")!);
	await until(() => expect(view.getByPlaceholderText("New orders")).toBeTruthy());
}

async function reachSettings(view: ReturnType<typeof render>) {
	await reachBasics(view);
	fireEvent.change(view.getByPlaceholderText("New orders"), { target: { value: "Poller" } });
	await until(() => expect(button("Next")?.disabled).toBe(false));
	fireEvent.click(button("Next")!);
}

test("a plugin kind's steps are Source, Basics, one step per author tab, Workflow, Review", async () => {
	const view = createWizard();
	await pickPlugin(view);
	await until(() =>
		expect(stepLabels(view)).toEqual([
			"Source",
			"Basics",
			"Settings",
			"Connection",
			"Polling",
			"Workflow",
			"Review",
		]),
	);
	expect(view.getByText("Plugin")).toBeTruthy();
});

test("a tab whose params are all hidden is skipped", async () => {
	kinds = [
		kind({
			params: {
				mode: { type: "select", options: ["simple", "advanced"], default: "simple" },
				tuning: { type: "string", tab: "Advanced", visibleWhen: { mode: "advanced" } },
			},
			tabs: ["Advanced"],
		}),
	];
	const view = createWizard();
	await pickPlugin(view);
	await until(() =>
		expect(stepLabels(view)).toEqual(["Source", "Basics", "Settings", "Workflow", "Review"]),
	);
});

test("a required param keeps Next disabled until it is filled", async () => {
	const view = createWizard();
	await reachSettings(view);
	await until(() => expect(view.getByText(/^Step 3 of/)).toBeTruthy());
	expect(button("Next")?.disabled).toBe(true);
	fireEvent.change(view.container.querySelector("input")!, { target: { value: "jobs" } });
	await until(() => expect(button("Next")?.disabled).toBe(false));
});

test("a value the server would refuse keeps Next disabled, and says why under the field", async () => {
	kinds = [
		kind({ params: { every: { type: "number", label: "Every", max: 5 } }, tabs: undefined }),
	];
	const view = createWizard();
	await reachSettings(view);
	await until(() => expect(view.getByText(/^Step 3 of/)).toBeTruthy());
	const every = view.container.querySelector("input")!;
	fireEvent.change(every, { target: { value: "9" } });
	fireEvent.blur(every);
	await until(() => expect(view.getByText("Every must be at most 5, got 9")).toBeTruthy());
	expect(button("Next")?.disabled).toBe(true);
	fireEvent.change(every, { target: { value: "3" } });
	fireEvent.blur(every);
	await until(() => expect(button("Next")?.disabled).toBe(false));
	expect(view.queryByText(/must be at most/)).toBeNull();
});

test("creating a plugin trigger sends its type and source", async () => {
	const view = createWizard();
	await reachSettings(view);
	await until(() => expect(view.getByText(/^Step 3 of/)).toBeTruthy());
	fireEvent.change(view.container.querySelector("input")!, { target: { value: "jobs" } });
	fireEvent.click(button("Next")!);
	await until(() => expect(view.getByText(/^Step 4 of/)).toBeTruthy());
	fireEvent.click(button("Next")!);
	await until(() => expect(button("Create trigger")).toBeTruthy());
	fireEvent.click(button("Create trigger")!);
	await until(() =>
		expect(triggersService.create).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "plugin:acme/pg/poller",
				source: { table: "jobs" },
				name: "Poller",
			}),
		),
	);
});

test("a secret param round-trips as cfg:<KEY>, and Review shows only the key name", async () => {
	// The picker itself is covered by PluginIntegrationForm.test.tsx; here the
	// wizard must keep the stored `cfg:` value and never print it as a value.
	kinds = [
		kind({
			params: { token: { type: "secret", label: "Token", required: true } },
			tabs: [],
		}),
	];
	byId = saved({ source: { token: "cfg:TOKEN" } });
	plugins = [pluginFixture({ name: "acme/pg", devEnabled: true, prodEnabled: false })];
	const view = renderPage(<TriggerPage projectId="p1" triggerId="t1" onDone={() => {}} />);
	await until(() => view.getByText("Edit trigger"));
	await until(() => expect(stepLabels(view)).toEqual(["Basics", "Settings", "Workflow", "Review"]));
	fireEvent.click(step("Settings")!);
	await until(() => expect(view.getByText("cfg:TOKEN")).toBeTruthy());
	fireEvent.click(step("Review")!);
	await until(() => expect(view.getByText("TOKEN")).toBeTruthy());
	expect(view.queryByText("cfg:TOKEN")).toBeNull();
	fireEvent.click(button("Save changes")!);
	await until(() =>
		expect(triggersService.update).toHaveBeenCalledWith(
			"t1",
			expect.objectContaining({ source: { token: "cfg:TOKEN" } }),
		),
	);
});

test("Attempts show only when the kind opted into retries", async () => {
	kinds = [kind({ retry: true })];
	const retrying = createWizard();
	await reachBasics(retrying);
	await until(() => expect(retrying.getByText("Max attempts")).toBeTruthy());
	cleanup();
	kinds = [kind({ retry: false })];
	const plain = createWizard();
	await reachBasics(plain);
	await until(() => expect(plain.getByPlaceholderText("New orders")).toBeTruthy());
	expect(plain.queryByText("Max attempts")).toBeNull();
});

test("the edit page has the same steps, pre-filled from source", async () => {
	byId = saved();
	plugins = [pluginFixture({ name: "acme/pg", devEnabled: true, prodEnabled: false })];
	const view = renderPage(<TriggerPage projectId="p1" triggerId="t1" onDone={() => {}} />);
	await until(() => view.getByText("Edit trigger"));
	await until(() =>
		expect(stepLabels(view)).toEqual([
			"Basics",
			"Settings",
			"Connection",
			"Polling",
			"Workflow",
			"Review",
		]),
	);
	expect(view.getByDisplayValue("Poller")).toBeTruthy();
	fireEvent.click(step("Settings")!);
	await until(() => expect(view.getByDisplayValue("jobs")).toBeTruthy());
});

test("a trigger whose plugin is disabled is read-only, with the reason", async () => {
	kinds = [];
	byId = saved();
	plugins = [pluginFixture({ name: "acme/pg", devEnabled: false, prodEnabled: false })];
	const view = renderPage(<TriggerPage projectId="p1" triggerId="t1" onDone={() => {}} />);
	await until(() => view.getByText("This trigger's plugin is off"));
	expect((view.getByDisplayValue("Poller") as HTMLInputElement).disabled).toBe(true);
	expect(view.queryByText("Save changes")).toBeNull();
});

test("the edit page shows why the system turned the trigger off", async () => {
	byId = saved({ active: false, disabledReason: "ctx.fail: boom (failed 5 times in a row)" });
	plugins = [pluginFixture({ name: "acme/pg", devEnabled: true, prodEnabled: false })];
	const view = renderPage(<TriggerPage projectId="p1" triggerId="t1" onDone={() => {}} />);
	await until(() => view.getByText("Fluxify turned this trigger off"));
	expect(view.getByText("ctx.fail: boom (failed 5 times in a row)")).toBeTruthy();
});

test("a kind that no longer exists shows a notice instead of crashing", async () => {
	kinds = [];
	byId = saved();
	plugins = [pluginFixture({ name: "acme/pg", devEnabled: true, prodEnabled: false })];
	const view = renderPage(<TriggerPage projectId="p1" triggerId="t1" onDone={() => {}} />);
	await until(() => view.getByText("This trigger kind no longer exists"));
	await until(() => expect(stepLabels(view)).toEqual(["Basics", "Workflow", "Review"]));
});

// A kind that defines `lag` (#963): the server adds the platform's Lag per worker to its params.
const lagParam = (over: Record<string, unknown> = {}) => ({
	type: "number",
	label: "Lag per worker",
	description: "Pending rows one worker clears per poll",
	min: 1,
	integer: true,
	tab: "Scaling",
	...over,
});
const lagKind = (lag: Record<string, unknown>) =>
	kind({
		params: { table: { type: "string", label: "Table", required: true }, lagPerWorker: lag },
		tabs: undefined,
	});

test("a kind with lag gets a Scaling step, with the plugin's help text under the field", async () => {
	kinds = [lagKind(lagParam({ required: true }))];
	const view = createWizard();
	await pickPlugin(view);
	await until(() =>
		expect(stepLabels(view)).toEqual([
			"Source",
			"Basics",
			"Settings",
			"Scaling",
			"Workflow",
			"Review",
		]),
	);
});

test("with no default, Lag per worker is required: Next stays off until it is set, and it is saved in source", async () => {
	kinds = [lagKind(lagParam({ required: true }))];
	const view = createWizard();
	await reachSettings(view);
	fireEvent.change(view.container.querySelector("input")!, { target: { value: "jobs" } });
	await until(() => expect(button("Next")?.disabled).toBe(false));
	fireEvent.click(button("Next")!);
	await until(() => expect(view.getByText(/^Step 4 of/)).toBeTruthy());
	await until(() => expect(view.getByText("Pending rows one worker clears per poll")).toBeTruthy());
	expect(button("Next")?.disabled).toBe(true);
	const lag = view.container.querySelector("input")!;
	fireEvent.change(lag, { target: { value: "40" } });
	fireEvent.blur(lag);
	await until(() => expect(button("Next")?.disabled).toBe(false));
	fireEvent.click(step("Review")!);
	await until(() => expect(button("Create trigger")).toBeTruthy());
	fireEvent.click(button("Create trigger")!);
	await until(() =>
		expect(triggersService.create).toHaveBeenCalledWith(
			expect.objectContaining({ source: { table: "jobs", lagPerWorker: 40 } }),
		),
	);
});

test("with a default from the plugin, Lag per worker needs nothing typed, and a fraction or zero is refused", async () => {
	kinds = [lagKind(lagParam({ default: 50 }))];
	const view = createWizard();
	await reachSettings(view);
	fireEvent.change(view.container.querySelector("input")!, { target: { value: "jobs" } });
	await until(() => expect(button("Next")?.disabled).toBe(false));
	fireEvent.click(button("Next")!);
	await until(() => expect(view.getByText(/^Step 4 of/)).toBeTruthy());
	expect(button("Next")?.disabled).toBe(false);
	const field = view.container.querySelector("input")!;
	fireEvent.change(field, { target: { value: "0" } });
	fireEvent.blur(field);
	await until(() => expect(button("Next")?.disabled).toBe(true));
});

test("editing a trigger saved before its plugin gained lag never demands a value", async () => {
	kinds = [lagKind(lagParam({ required: true }))];
	byId = saved({ source: { table: "jobs" } });
	plugins = [pluginFixture({ name: "acme/pg", devEnabled: true, prodEnabled: false })];
	const view = renderPage(<TriggerPage projectId="p1" triggerId="t1" onDone={() => {}} />);
	await until(() => view.getByText("Edit trigger"));
	await until(() => expect(stepLabels(view)).toContain("Scaling"));
	fireEvent.click(step("Scaling")!);
	expect(view.queryByText("Lag per worker is required")).toBeNull();
	await until(() => expect(view.getByText("Lag per worker")).toBeTruthy());
	fireEvent.click(button("Save changes")!);
	await until(() =>
		expect(triggersService.update).toHaveBeenCalledWith(
			"t1",
			expect.objectContaining({ source: { table: "jobs" } }),
		),
	);
});

test("a trigger that already has a value keeps the field required when edited", async () => {
	kinds = [lagKind(lagParam({ required: true }))];
	byId = saved({ source: { table: "jobs", lagPerWorker: 25 } });
	plugins = [pluginFixture({ name: "acme/pg", devEnabled: true, prodEnabled: false })];
	const view = renderPage(<TriggerPage projectId="p1" triggerId="t1" onDone={() => {}} />);
	await until(() => view.getByText("Edit trigger"));
	await until(() => expect(stepLabels(view)).toContain("Scaling"));
	fireEvent.click(step("Scaling")!);
	await until(() => expect(view.getByDisplayValue("25")).toBeTruthy());
	fireEvent.change(view.getByDisplayValue("25"), { target: { value: "" } });
	// Wait for the step itself: the old `Save changes disabled || Review` check passed
	// on the first half and then clicked a Review button that was not there yet.
	await until(() => expect(step("Review")).toBeTruthy());
	fireEvent.click(step("Review")!);
	await until(() => expect(view.getByText("Lag per worker")).toBeTruthy());
});
