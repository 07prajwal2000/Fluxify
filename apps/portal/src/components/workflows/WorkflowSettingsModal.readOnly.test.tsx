import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { WorkflowSettingsModal } = await import("./WorkflowSettingsModal");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

// queries come from render(), not `screen`: in a shared test process `screen`
// can still point at an earlier file's document
function renderSettings(readOnly: boolean) {
	// seeded and never stale, so nothing is fetched
	const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
	client.setQueryData(["workflows", "w1", "by-id"], {
		id: "w1",
		projectId: "p1",
		name: "Nightly report",
		description: "",
		active: true,
		timeoutSeconds: 60,
		tracingEnabled: true,
		recordExecution: true,
	});
	return render(
		<QueryClientProvider client={client}>
			<WorkflowSettingsModal workflowId="w1" isOpen onOpenChange={() => {}} readOnly={readOnly} />
		</QueryClientProvider>,
	);
}

test("a viewer sees workflow settings read-only, with no Save or Danger zone", () => {
	const view = renderSettings(true);
	expect(view.getByRole("textbox", { name: "Name" }).hasAttribute("readonly")).toBe(true);
	expect(view.queryByRole("button", { name: "Save changes" })).toBeNull();
	expect(view.queryByRole("tab", { name: "Danger zone" })).toBeNull();
	expect(view.getByRole("button", { name: "Close" })).toBeTruthy();
});

test("a creator can edit workflow settings", () => {
	const view = renderSettings(false);
	expect(view.getByRole("textbox", { name: "Name" }).hasAttribute("readonly")).toBe(false);
	expect(view.getByRole("button", { name: "Save changes" })).toBeTruthy();
	expect(view.getByRole("tab", { name: "Danger zone" })).toBeTruthy();
});
