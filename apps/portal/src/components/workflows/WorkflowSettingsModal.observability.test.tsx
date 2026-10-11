import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { toast } = await import("@fluxify/components");
const { WorkflowSettingsModal } = await import("./WorkflowSettingsModal");
const { workflowsService } = await import("@/services/workflows");
const { PROD_RECORDING_HINT } = await import("@/components/settings/ObservabilityTabs");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

const WARNING = "Recording is heavy at scale. Prefer tracing, or open the route in a sandbox.";

function renderSettings(readOnly = false) {
	const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
	const workflow = {
		id: "w1",
		projectId: "p1",
		name: "Nightly report",
		description: "",
		active: true,
		timeoutSeconds: 60,
		tracingEnabled: false,
		recordExecution: false,
		devTracingEnabled: false,
		devRecordExecution: true,
	};
	// the query may refetch on mount, so the service answers with the same workflow
	spyOn(workflowsService, "getById").mockResolvedValue(workflow as never);
	client.setQueryData(["workflows", "w1", "by-id"], workflow);
	client.setQueryData(["public-settings"], { recordingMaxAgeDays: 30 });
	return render(
		<QueryClientProvider client={client}>
			<WorkflowSettingsModal workflowId="w1" isOpen onOpenChange={() => {}} readOnly={readOnly} />
		</QueryClientProvider>,
	);
}

/** Tabs and checkboxes are React Aria: they answer a click on their element. */
function click(el: HTMLElement) {
	return act(async () => {
		fireEvent.click(el);
	});
}

test("development is the default tab and shows the saved switches", async () => {
	const view = renderSettings();
	await click(view.getByRole("tab", { name: "Advanced" }));
	expect(view.getByRole("tab", { name: "Development" }).getAttribute("aria-selected")).toBe("true");
	expect((view.getByRole("checkbox", { name: /Recording/ }) as HTMLInputElement).checked).toBe(
		true,
	);
	expect((view.getByRole("checkbox", { name: /Tracing/ }) as HTMLInputElement).checked).toBe(false);
	expect(view.queryByText(PROD_RECORDING_HINT)).toBeNull();
});

test("both tabs save their own fields, and production recording shows the warning", async () => {
	const update = spyOn(workflowsService, "update").mockResolvedValue({
		id: "w1",
		warning: WARNING,
	} as never);
	const warn = spyOn(toast, "warning").mockImplementation((() => "") as never);
	const view = renderSettings();
	await click(view.getByRole("tab", { name: "Advanced" }));

	// development: turn tracing on
	await click(view.getByRole("checkbox", { name: /Tracing/ }));
	// production: turn recording on; the hint sits under the toggle
	await click(view.getByRole("tab", { name: "Production" }));
	expect(view.getByText(PROD_RECORDING_HINT)).toBeTruthy();
	await click(view.getByRole("checkbox", { name: /Recording/ }));

	await click(view.getByRole("button", { name: "Save changes" }));
	await act(() => new Promise((r) => setTimeout(r, 20)));

	expect(update).toHaveBeenCalledTimes(1);
	const [id, body] = update.mock.calls[0] as [string, Record<string, unknown>];
	expect(id).toBe("w1");
	expect(body).toMatchObject({ devTracingEnabled: true, recordExecution: true });
	// untouched switches are not resent
	expect(body).not.toHaveProperty("devRecordExecution");
	expect(body).not.toHaveProperty("tracingEnabled");
	expect(warn).toHaveBeenCalledWith(WARNING);
});

test("a viewer cannot flip a switch", async () => {
	const view = renderSettings(true);
	await click(view.getByRole("tab", { name: "Advanced" }));
	expect(view.getByRole("checkbox", { name: /Recording/ }).hasAttribute("disabled")).toBe(true);
});
