import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { authStore } = await import("@/store/auth");
const { customBlocksService } = await import("@/services/customBlocks");
const { referencesService } = await import("@/services/references");
const { DeployDialog } = await import("./DeployDialog");

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

const version = {
	id: "version-2",
	kind: "custom_block" as const,
	targetId: "b1",
	versionNumber: 2,
	title: "Add a header",
	description: null,
	author: "Ada",
	authorEmail: "ada@x.io",
	createdAt: "2026-10-01T10:00:00.000Z",
	parentId: null,
	isHead: true,
	isProd: false,
};

function mount() {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<DeployDialog
				kind="custom_block"
				id="b1"
				projectId="p1"
				version={version as never}
				liveVersionNumber={null}
				onClose={() => {}}
			/>
		</QueryClientProvider>,
	);
}

beforeEach(() =>
	authStore.setState((s) => {
		s.state.acl = { p1: "creator" };
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
	}),
);

test("a block promote counts the production routes and workflows it will change", async () => {
	spyOn(customBlocksService, "getById").mockResolvedValue({
		id: "b1",
		projectId: "p1",
		label: "Slack notifier",
		prodVersionNumber: null,
		uncommitted: false,
	} as never);
	spyOn(referencesService, "list").mockResolvedValue([
		{ kind: "route", id: "r1", name: "GET /a", inProduction: true, inWorkingCopy: false },
		{ kind: "workflow", id: "w1", name: "Nightly", inProduction: true, inWorkingCopy: false },
		// a working-copy-only user does not change, so it is not counted
		{ kind: "route", id: "r2", name: "GET /b", inProduction: false, inWorkingCopy: true },
	] as never);
	const view = mount();
	await until(() => view.getByText("2 production routes and workflows will change"));
});

test("a block with no production users shows no change count", async () => {
	spyOn(customBlocksService, "getById").mockResolvedValue({
		id: "b1",
		projectId: "p1",
		label: "Slack notifier",
		prodVersionNumber: null,
		uncommitted: false,
	} as never);
	spyOn(referencesService, "list").mockResolvedValue([
		{ kind: "route", id: "r2", name: "GET /b", inProduction: false, inWorkingCopy: true },
	] as never);
	const view = mount();
	await act(() => new Promise((r) => setTimeout(r, 60)));
	expect(view.queryByText(/will change/)).toBeNull();
});
