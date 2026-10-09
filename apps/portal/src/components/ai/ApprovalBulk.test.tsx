import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { ApprovalBar } = await import("./ApprovalBar");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const q = () => within(document.body);
const call = (id: string, name = "save_route", isDelete = false) =>
	({
		kind: "tool",
		id,
		name,
		title: `${name} ${id}`,
		input: { name: id },
		isDelete,
	}) as const;

function show(calls: ReturnType<typeof call>[]) {
	const onDecide = mock(async (_d: unknown) => {});
	render(
		<ApprovalBar
			request={calls[0]}
			calls={calls}
			onApprove={async () => {}}
			onReject={async () => {}}
			onDecide={onDecide}
		/>,
	);
	return onDecide;
}
const press = async (name: string | RegExp) => {
	fireEvent.click(q().getByRole("button", { name }));
	await act(() => new Promise((r) => setTimeout(r, 20)));
};

test("Approve all and Review all show only with 2 or more pending", () => {
	show([call("a")]);
	expect(q().queryByRole("button", { name: /Approve all/ })).toBeNull();
	expect(q().queryByRole("button", { name: "Review all" })).toBeNull();
	expect(q().getByRole("button", { name: "Approve" })).toBeTruthy();
	cleanup();
	show([call("a"), call("b")]);
	expect(q().getByRole("button", { name: "Approve all (2)" })).toBeTruthy();
	expect(q().getByRole("button", { name: "Review all" })).toBeTruthy();
	expect(q().getByRole("button", { name: "Approve" })).toBeTruthy();
});

test("Approve all leaves deletes out and says so", async () => {
	const onDecide = show([call("a"), call("d", "delete_route", true), call("b")]);
	await press("Approve all (2) · 1 delete needs review");
	expect(onDecide).toHaveBeenCalledWith([
		{ toolCallId: "a", approve: true },
		{ toolCallId: "b", approve: true },
	]);
});

test("only deletes pending: no Approve all, but they can be reviewed", () => {
	show([call("d1", "delete_route", true), call("d2", "delete_route", true)]);
	expect(q().queryByRole("button", { name: /Approve all/ })).toBeNull();
	expect(q().getByRole("button", { name: "Review all" })).toBeTruthy();
});

test("the dialog sends one request with a decision per answered row; the rest keep waiting", async () => {
	const onDecide = show([call("a"), call("b"), call("c")]);
	await press("Review all");
	await press("Approve save_route a");
	await press("Reject save_route b");
	await press("Confirm (2)");
	expect(onDecide).toHaveBeenCalledTimes(1);
	expect(onDecide).toHaveBeenCalledWith([
		{ toolCallId: "a", approve: true },
		{ toolCallId: "b", approve: false },
	]);
});

test("dialog: Approve all skips deletes, Reject all covers them, a delete can be approved on its own row", async () => {
	const onDecide = show([call("a"), call("d", "delete_route", true)]);
	await press("Review all");
	await press("Approve all");
	await press("Confirm (1)");
	expect(onDecide).toHaveBeenLastCalledWith([{ toolCallId: "a", approve: true }]);

	cleanup();
	const again = show([call("a"), call("d", "delete_route", true)]);
	await press("Review all");
	await press("Reject all");
	await press("Approve delete_route d");
	await press("Confirm (2)");
	expect(again).toHaveBeenLastCalledWith([
		{ toolCallId: "a", approve: false },
		{ toolCallId: "d", approve: true },
	]);
});
