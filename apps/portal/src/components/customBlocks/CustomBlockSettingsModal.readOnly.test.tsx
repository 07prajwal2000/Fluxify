import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { CustomBlockSettingsModal } = await import("./CustomBlockSettingsModal");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

// queries come from render(), not `screen`: in a shared test process `screen`
// can still point at an earlier file's document
function renderSettings(readOnly: boolean, sourceType = "user-defined") {
	// seeded and never stale, so nothing is fetched
	const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
	client.setQueryData(
		["custom-blocks", "p1"],
		[
			{
				id: "b1",
				name: "sendSlack",
				label: "Send Slack",
				description: "",
				usage: "flow",
				inputParams: [],
				sourceType,
			},
		],
	);
	return render(
		<QueryClientProvider client={client}>
			<CustomBlockSettingsModal
				projectId="p1"
				blockId="b1"
				isOpen
				onOpenChange={() => {}}
				readOnly={readOnly}
			/>
		</QueryClientProvider>,
	);
}

test("a viewer sees custom block settings read-only, with no Save or Danger zone", () => {
	const view = renderSettings(true);
	expect(view.getByRole("textbox", { name: "Label" }).hasAttribute("disabled")).toBe(true);
	expect(view.queryByRole("button", { name: "Save changes" })).toBeNull();
	expect(view.queryByRole("tab", { name: "Danger zone" })).toBeNull();
	expect(view.getByText(/View only/)).toBeTruthy();
});

test("a creator can edit a user-defined custom block", () => {
	const view = renderSettings(false);
	expect(view.getByRole("textbox", { name: "Label" }).hasAttribute("disabled")).toBe(false);
	expect(view.getByRole("button", { name: "Save changes" })).toBeTruthy();
	expect(view.getByRole("tab", { name: "Danger zone" })).toBeTruthy();
});

test("a creator still can't edit a block from another source", () => {
	const view = renderSettings(false, "git");
	expect(view.queryByRole("button", { name: "Save changes" })).toBeNull();
	expect(view.getByText(/comes from a git source/)).toBeTruthy();
});
