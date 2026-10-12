import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { customBlocksService } = await import("@/services/customBlocks");
const { versionsService } = await import("@/services/versions");
const { deploymentsService } = await import("@/services/deployments");
const { DependencyPromoteDialog } = await import("./DependencyPromoteDialog");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

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

const button = (name: string) => {
	const found = [...document.body.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === name,
	);
	if (!found) throw new Error(`no button ${name}`);
	return found as HTMLButtonElement;
};

function mount(onPromoted: () => void) {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<DependencyPromoteDialog
				subjectName="GET /orders"
				dependency={{ kind: "custom_block", id: "b1", name: "Slack notifier" } as never}
				projectId="p1"
				onClose={() => {}}
				onPromoted={onPromoted}
			/>
		</QueryClientProvider>,
	);
}

test("it commits the uncommitted work, then promotes, then says it is live", async () => {
	spyOn(customBlocksService, "getById").mockResolvedValue({
		id: "b1",
		projectId: "p1",
		label: "Slack notifier",
		headVersionNumber: 1,
		uncommitted: true,
	} as never);
	spyOn(versionsService, "list").mockResolvedValue({
		versions: [{ id: "old-head", versionNumber: 1, isHead: true }],
		uncommitted: true,
	} as never);
	const commit = spyOn(versionsService, "commit").mockResolvedValue({
		id: "new-head",
		versionNumber: 2,
	} as never);
	const deploy = spyOn(deploymentsService, "deploy").mockResolvedValue({
		id: "d1",
		status: "live",
		versionNumber: 2,
		gates: [],
	} as never);
	const onPromoted = mock(() => undefined);

	mount(onPromoted);
	const submit = await until(() => button("Commit & promote"));
	// the description is required
	expect(submit.disabled).toBe(true);
	// the commit title is prefilled from the subject
	const input = document.body.querySelector("input") as HTMLInputElement;
	expect(input.value).toBe("Promote for GET /orders");

	const textarea = document.body.querySelector("textarea") as HTMLTextAreaElement;
	fireEvent.change(textarea, { target: { value: "so the route can go live" } });
	await until(() => expect(submit.disabled).toBe(false));
	fireEvent.click(submit);

	await until(() => expect(commit).toHaveBeenCalled());
	expect(commit).toHaveBeenCalledWith("custom_block", "b1", {
		title: "Promote for GET /orders",
		description: "so the route can go live",
	});
	await until(() =>
		expect(deploy).toHaveBeenCalledWith("custom_block", "b1", {
			versionId: "new-head",
			description: "so the route can go live",
		}),
	);
	await until(() => expect(onPromoted).toHaveBeenCalled());
});

test("a dependency with nothing uncommitted promotes its head without committing", async () => {
	spyOn(customBlocksService, "getById").mockResolvedValue({
		id: "b1",
		projectId: "p1",
		label: "Slack notifier",
		headVersionNumber: 1,
		uncommitted: false,
	} as never);
	spyOn(versionsService, "list").mockResolvedValue({
		versions: [{ id: "head", versionNumber: 1, isHead: true }],
		uncommitted: false,
	} as never);
	const commit = spyOn(versionsService, "commit");
	const deploy = spyOn(deploymentsService, "deploy").mockResolvedValue({
		id: "d1",
		status: "live",
		versionNumber: 1,
		gates: [],
	} as never);

	mount(() => undefined);
	const submit = await until(() => button("Promote"));
	const textarea = document.body.querySelector("textarea") as HTMLTextAreaElement;
	fireEvent.change(textarea, { target: { value: "go live" } });
	await until(() => expect(submit.disabled).toBe(false));
	fireEvent.click(submit);

	await until(() =>
		expect(deploy).toHaveBeenCalledWith("custom_block", "b1", {
			versionId: "head",
			description: "go live",
		}),
	);
	expect(commit).not.toHaveBeenCalled();
});
