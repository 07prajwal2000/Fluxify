import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { toast } = await import("@fluxify/components");
const { authStore } = await import("@/store/auth");
const { customBlocksService } = await import("@/services/customBlocks");
const { middlewaresService } = await import("@/services/middlewares");
const { versionsService } = await import("@/services/versions");
const { CommitControls } = await import("./CommitControls");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

/** Not RTL's waitFor: it stays bound to the DOM of whichever test file loaded RTL first. */
async function until<T>(check: () => T, timeout = 1500): Promise<T> {
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

function setRole(role: "viewer" | "creator") {
	authStore.setState((s) => {
		s.state.acl = { p1: role };
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
	});
}

function renderControls(kind: "custom_block" | "middleware", id: string, onOpenHistory = () => {}) {
	return render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<CommitControls
				kind={kind}
				id={id}
				projectId="p1"
				canvas={{ hasUnsavedChanges: false, saveChanges: async () => true }}
				onOpenHistory={onOpenHistory}
			/>
		</QueryClientProvider>,
	);
}

const commitButton = (view: ReturnType<typeof render>) =>
	view.getByRole("button", { name: /Commit/ }) as HTMLButtonElement;

async function commitWith(view: ReturnType<typeof render>, title: string) {
	fireEvent.click(commitButton(view));
	const input = (await until(() => {
		const found = document.body.querySelector("input");
		if (!found) throw new Error("no title box");
		return found;
	})) as HTMLInputElement;
	fireEvent.change(input, { target: { value: title } });
	const submit = (await until(() => {
		const found = [...document.body.querySelectorAll("form button")].find(
			(b) => (b as HTMLButtonElement).type === "submit",
		);
		if (!found) throw new Error("no submit");
		return found;
	})) as HTMLButtonElement;
	await until(() => expect(submit.disabled).toBe(false));
	fireEvent.click(submit);
}

beforeEach(() => setRole("creator"));

test("a custom block's commit posts with the custom_block kind", async () => {
	spyOn(customBlocksService, "getById").mockResolvedValue({
		id: "b1",
		projectId: "p1",
		label: "Slack",
		headVersionNumber: 1,
		uncommitted: true,
	} as never);
	const commit = spyOn(versionsService, "commit").mockResolvedValue({
		id: "v1",
		versionNumber: 2,
	} as never);
	const success = spyOn(toast, "success").mockImplementation((() => "") as never);
	const view = renderControls("custom_block", "b1");
	await until(() => view.getByRole("img", { name: "Uncommitted changes" }));
	await commitWith(view, "First");
	await until(() => expect(commit).toHaveBeenCalled());
	expect(commit).toHaveBeenCalledWith("custom_block", "b1", {
		title: "First",
		description: undefined,
	});
	await until(() => expect(success).toHaveBeenCalledWith("Committed v2"));
});

test("a middleware's commit posts with the middleware kind", async () => {
	spyOn(middlewaresService, "get").mockResolvedValue({
		id: "m1",
		projectId: "p1",
		name: "Auth",
		headVersionNumber: 1,
		uncommitted: true,
	} as never);
	const commit = spyOn(versionsService, "commit").mockResolvedValue({
		id: "v1",
		versionNumber: 3,
	} as never);
	const view = renderControls("middleware", "m1");
	await until(() => view.getByRole("img", { name: "Uncommitted changes" }));
	await commitWith(view, "First");
	await until(() => expect(commit).toHaveBeenCalled());
	expect(commit).toHaveBeenCalledWith("middleware", "m1", {
		title: "First",
		description: undefined,
	});
});

test("a viewer gets the history but no Commit on a custom block", async () => {
	setRole("viewer");
	spyOn(customBlocksService, "getById").mockResolvedValue({
		id: "b1",
		projectId: "p1",
		label: "Slack",
		headVersionNumber: 1,
		uncommitted: true,
	} as never);
	const opened = mock(() => undefined);
	const view = renderControls("custom_block", "b1", opened);
	await act(() => new Promise((r) => setTimeout(r, 40)));
	expect(view.queryByRole("button", { name: /Commit/ })).toBeNull();
	fireEvent.click(view.getByRole("button", { name: /Version history/ }));
	expect(opened).toHaveBeenCalled();
});
