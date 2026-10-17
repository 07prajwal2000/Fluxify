import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

try {
	GlobalRegistrator.register();
} catch {}
Element.prototype.scrollIntoView = () => {};

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { ApprovalBar } = await import("./ApprovalBar");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

test("approval card shows server badge and tool name for ext_ tools, and hides always allow", async () => {
	const onApprove = mock(async () => {});
	const onReject = mock(async () => {});

	const view = render(
		<ApprovalBar
			projectId="p1"
			request={{
				kind: "tool",
				id: "call-1",
				name: "ext_gh__create_issue",
				title: "create_issue (gh)",
				input: { title: "Fix bug" },
				isDelete: false,
				server: "gh",
			}}
			onApprove={onApprove}
			onReject={onReject}
		/>,
	);

	// Server badge "gh" is visible
	expect(view.getByText("gh")).not.toBeNull();
	// Tool name without server suffix
	expect(view.getByText("create_issue")).not.toBeNull();

	// Normal Approve button is rendered
	const approveBtn = view.getByRole("button", { name: "Approve" });
	expect(approveBtn).not.toBeNull();

	// SplitButton menu (which contains "Approve with Auto" / always allow) is NOT rendered for ext_
	expect(view.queryByLabelText("More approve options")).toBeNull();
	expect(view.queryByText("Approve with Auto")).toBeNull();

	// Clicking approve works
	await act(async () => {
		fireEvent.click(approveBtn);
	});
	expect(onApprove).toHaveBeenCalledWith(undefined, "");
});

test("approval card for standard internal tool offers SplitButton with Approve with Auto", () => {
	const onApprove = mock(async () => {});
	const onReject = mock(async () => {});

	const view = render(
		<ApprovalBar
			projectId="p1"
			request={{
				kind: "tool",
				id: "call-2",
				name: "save_route",
				title: "Save route",
				input: { path: "/test" },
				isDelete: false,
			}}
			onApprove={onApprove}
			onReject={onReject}
		/>,
	);

	// Shows tool title and no server badge
	expect(view.getByText("Save route")).not.toBeNull();
	expect(view.queryByText("gh")).toBeNull();

	// SplitButton trigger for "More approve options" is rendered
	expect(view.getByLabelText("More approve options")).not.toBeNull();
});
