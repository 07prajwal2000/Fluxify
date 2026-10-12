import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// the version link goes through the router; the test only needs the anchor
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	Link: ({ to, children, ...rest }: any) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ApprovalBar } = await import("./ApprovalBar");
const { isDeployTool, isProdCall } = await import("./agentApproval");
const { versionsService } = await import("@/services/versions");

// the version a promote/rollback names: read for its number and title
const VERSIONS = {
	uncommitted: false,
	versions: [
		{
			id: "v-a",
			kind: "route",
			targetId: "r1",
			versionNumber: 3,
			title: "Add rate limiting",
			description: null,
			author: "Ada",
			authorEmail: "ada@x.io",
			createdAt: "2026-10-01T10:00:00.000Z",
			parentId: null,
			isHead: true,
			isProd: false,
		},
	],
};
const list = spyOn(versionsService, "list").mockResolvedValue(VERSIONS as never);

afterEach(cleanup);
afterAll(() => {
	list.mockRestore();
	GlobalRegistrator.unregister();
});

const q = () => within(document.body);
const call = (id: string, name = "save_route") =>
	({
		kind: "tool",
		id,
		name,
		title: name === "promote_version" ? "Promote version" : `${name} ${id}`,
		input: { kind: "route", id: "r1", versionId: `v-${id}` },
		isDelete: false,
		isProd: isDeployTool(name),
		needsComment: isDeployTool(name),
	}) as const;

type Call = ReturnType<typeof call>;

function show(calls: Call[]) {
	const onApprove = mock(async (_mode: string | undefined, _comment?: string) => {});
	const onDecide = mock(async (_d: unknown) => {});
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ApprovalBar
				projectId="p1"
				request={calls[0]}
				calls={calls}
				onApprove={onApprove}
				onReject={async () => {}}
				onDecide={onDecide}
			/>
		</QueryClientProvider>,
	);
	return { onApprove, onDecide };
}
const press = async (name: string | RegExp) => {
	fireEvent.click(q().getByRole("button", { name }));
	await act(() => new Promise((r) => setTimeout(r, 20)));
};
const disabled = (el: HTMLElement) =>
	el.hasAttribute("disabled") ||
	el.getAttribute("aria-disabled") === "true" ||
	el.hasAttribute("data-disabled");
const type = (box: HTMLElement, value: string) => fireEvent.change(box, { target: { value } });
const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));
/** Not RTL's screen: it stays bound to the DOM of whichever test file loaded RTL first. */
async function until<T>(check: () => T, timeout = 1500): Promise<T> {
	const end = Date.now() + timeout;
	for (;;) {
		try {
			return check();
		} catch (e) {
			if (Date.now() > end) throw e;
			await settle();
		}
	}
}
const openMenu = async (name: string | RegExp) => {
	fireEvent.click(q().getByRole("button", { name: "More approve options" }));
	return until(() => q().getByRole("menuitem", { name }));
};

test("promote and rollback are production calls that need a comment", () => {
	expect(isDeployTool("promote_version")).toBe(true);
	expect(isDeployTool("rollback_version")).toBe(true);
	expect(isDeployTool("commit_version")).toBe(false);
	expect(isProdCall("promote_version", {})).toBe(true);
	expect(isProdCall("rollback_version", {})).toBe(true);
	expect(isProdCall("commit_version", {})).toBe(false);
});

test("a promote shows the Production badge and a comment box, and Approve waits for the comment", async () => {
	const { onApprove } = show([call("a", "promote_version")]);
	expect(q().getByText("Production")).toBeTruthy();
	const box = q().getByLabelText("Why is this going live?");
	const approve = q().getByRole("button", { name: "Approve" });
	expect(disabled(approve)).toBe(true);

	// spaces are not a reason
	type(box, "   ");
	expect(disabled(q().getByRole("button", { name: "Approve" }))).toBe(true);

	type(box, "Fixes the 500s on checkout");
	expect(disabled(q().getByRole("button", { name: "Approve" }))).toBe(false);
	await press("Approve");
	// plain Approve asks to keep the conversation's mode
	expect(onApprove).toHaveBeenCalledWith(undefined, "Fixes the 500s on checkout");
});

test("other calls have no comment box and approve at once", async () => {
	const { onApprove } = show([call("a")]);
	expect(q().queryByLabelText("Why is this going live?")).toBeNull();
	await press("Approve");
	expect(onApprove).toHaveBeenCalledTimes(1);
});

test("Approve all leaves deployments out and says they need a comment", async () => {
	const { onDecide } = show([call("a"), call("p", "promote_version"), call("b")]);
	await press("Approve all (2) · 1 deployment needs a comment");
	expect(onDecide).toHaveBeenCalledWith([
		{ toolCallId: "a", approve: true },
		{ toolCallId: "b", approve: true },
	]);
});

test("in Review all each deployment has its own comment box and cannot be approved without it", async () => {
	const { onDecide } = show([
		call("p1", "promote_version"),
		call("a"),
		call("p2", "promote_version"),
	]);
	await press("Review all");
	const boxes = q().getAllByLabelText(/^Why: Promote version/);
	expect(boxes).toHaveLength(2);
	const approves = q().getAllByRole("button", { name: "Approve Promote version" });
	expect(approves.every(disabled)).toBe(true);

	type(boxes[0], "first reason");
	expect(disabled(q().getAllByRole("button", { name: "Approve Promote version" })[0])).toBe(false);
	expect(disabled(q().getAllByRole("button", { name: "Approve Promote version" })[1])).toBe(true);
	fireEvent.click(q().getAllByRole("button", { name: "Approve Promote version" })[0]);
	await press("Approve save_route a");
	// the second deployment is turned down: no comment needed for a no
	fireEvent.click(q().getAllByRole("button", { name: "Reject Promote version" })[1]);
	await press("Confirm (3)");

	expect(onDecide).toHaveBeenCalledWith([
		{ toolCallId: "p1", approve: true, comment: "first reason" },
		{ toolCallId: "a", approve: true },
		{ toolCallId: "p2", approve: false },
	]);
});

test("Review all's Approve all skips deployments, and clearing a comment takes the approval back", async () => {
	const { onDecide } = show([call("p", "promote_version"), call("a"), call("b")]);
	await press("Review all");
	const dialog = within(document.body);
	// the dialog's own Approve all, not the bar's
	const approveAll = dialog.getAllByRole("button", { name: "Approve all" });
	fireEvent.click(approveAll[approveAll.length - 1]);
	await act(() => new Promise((r) => setTimeout(r, 20)));
	expect(dialog.getByRole("button", { name: "Confirm (2)" })).toBeTruthy();

	type(dialog.getByLabelText(/^Why: Promote version/), "because");
	fireEvent.click(dialog.getByRole("button", { name: "Approve Promote version" }));
	await act(() => new Promise((r) => setTimeout(r, 20)));
	expect(dialog.getByRole("button", { name: "Confirm (3)" })).toBeTruthy();

	type(dialog.getByLabelText(/^Why: Promote version/), "");
	await act(() => new Promise((r) => setTimeout(r, 20)));
	expect(dialog.getByRole("button", { name: "Confirm (2)" })).toBeTruthy();
	await press("Confirm (2)");
	expect(onDecide).toHaveBeenCalledWith([
		{ toolCallId: "a", approve: true },
		{ toolCallId: "b", approve: true },
	]);
});

test("an empty comment keeps both Approve and Approve with Auto disabled (#778)", async () => {
	show([call("a", "promote_version")]);
	expect(disabled(q().getByRole("button", { name: "Approve" }))).toBe(true);
	const auto = await openMenu("Approve with Auto");
	expect(disabled(auto)).toBe(true);
});

test("the typed comment goes with Approve (#778)", async () => {
	const { onApprove } = show([call("a", "promote_version")]);
	type(q().getByLabelText("Why is this going live?"), "Fixes the 500s");
	await press("Approve");
	expect(onApprove).toHaveBeenCalledWith(undefined, "Fixes the 500s");
});

test("the typed comment goes with Approve with Auto (#778)", async () => {
	const { onApprove } = show([call("a", "promote_version")]);
	type(q().getByLabelText("Why is this going live?"), "Fixes the 500s");
	const auto = await openMenu("Approve with Auto");
	fireEvent.click(auto);
	await settle();
	expect(onApprove).toHaveBeenCalledWith("auto", "Fixes the 500s");
});

test("a promote shows its version as a link to the read-only canvas, by number and title (#778)", async () => {
	show([call("a", "promote_version")]);
	await settle();
	const link = q().getByText("v3 · Add rate limiting").closest("a");
	expect(link?.getAttribute("href")).toContain("/$projectId/canvas/$routeId/versions");
	// the raw uuid never shows
	expect(q().queryByText(/v-a/)).toBeNull();
});
