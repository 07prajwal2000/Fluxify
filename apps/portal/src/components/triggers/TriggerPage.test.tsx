import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { triggersService } = await import("@/services/triggers");
const { TriggerPage } = await import("./TriggerPage");
const { TriggerWizard } = await import("./TriggerWizard");

/** Not RTL's findBy/waitFor: those stay bound to the DOM of whichever test file loaded RTL first. */
async function until<T>(check: () => T, timeout = 2000): Promise<T> {
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

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => {
	mock.restore();
	spyOn(triggersService, "getGroups").mockResolvedValue([]);
	// the wizard asks for the project's plugin kinds; this test has no HTTP
	spyOn(triggersService, "getPluginKinds").mockResolvedValue([]);
});

const saved = {
	id: "t1",
	name: "New orders",
	description: null,
	type: "kafka",
	projectId: "p1",
	workflowId: null,
	sandboxId: null,
	groupId: "g1",
	integrationId: "i1",
	batchSize: 10,
	maxWaitMs: 1000,
	maxBytes: 1_000_000,
	concurrency: 1,
	payload: null,
	source: { topics: ["orders"] },
	commitMode: "auto",
	maxAttempts: 3,
	retryDelayMs: 1000,
	schedule: null,
	timezone: "UTC",
	active: true,
	disabledReason: null,
	createdAt: "2026-10-22T00:00:00.000Z",
	updatedAt: "2026-10-22T00:00:00.000Z",
};

const page = (triggerId = "t1", projectId = "p1") =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<TriggerPage projectId={projectId} triggerId={triggerId} onDone={() => {}} />
		</QueryClientProvider>,
	);
const stepLabels = (view: ReturnType<typeof render>) =>
	[...view.getByRole("navigation", { name: "Setup steps" }).querySelectorAll("li")].map(
		(li) => li.textContent,
	);

test("a saved trigger opens on its own page, its source in the header and not a step (#932)", async () => {
	const get = spyOn(triggersService, "getById").mockResolvedValue(saved as never);
	const view = page();
	await until(() => view.getByText("Edit trigger"));
	expect(get).toHaveBeenCalledWith("t1");
	expect(view.getByRole("heading", { level: 1 }).parentElement?.textContent).toContain("Kafka");
	expect(stepLabels(view).some((label) => label?.includes("Source"))).toBe(false);
	expect(stepLabels(view)[0]).toContain("Basics");
	expect(view.getByDisplayValue("New orders")).toBeTruthy();
});

test("only the step scrolls: header, stepper and footer stay put (#932)", async () => {
	spyOn(triggersService, "getById").mockResolvedValue(saved as never);
	const view = page();
	await until(() => view.getByText("Edit trigger"));
	const scroller = view.getByText(/^Step 1 of/).closest(".overflow-y-auto");
	expect(scroller).not.toBeNull();
	expect(scroller?.contains(view.getByRole("navigation", { name: "Setup steps" }))).toBe(false);
	expect(scroller?.contains(view.getByText("Edit trigger"))).toBe(false);
	expect(scroller?.contains(view.getByText("Save changes"))).toBe(false);
});

test("a missing trigger, or one from another project, says it is not found", async () => {
	spyOn(triggersService, "getById").mockRejectedValue(new Error("Not found"));
	const missing = page("missing");
	expect(await until(() => missing.getByText("Trigger not found"))).toBeTruthy();
	cleanup();
	spyOn(triggersService, "getById").mockResolvedValue(saved as never);
	const elsewhere = page("t1", "another-project");
	expect(await until(() => elsewhere.getByText("Trigger not found"))).toBeTruthy();
});

test("creating a trigger still starts on the Source step", () => {
	const view = render(
		<QueryClientProvider client={new QueryClient()}>
			<TriggerWizard projectId="p1" onBack={() => {}} onSuccess={() => {}} />
		</QueryClientProvider>,
	);
	expect(stepLabels(view)[0]).toContain("Source");
});
