import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { toast } = await import("@fluxify/components");
const { authStore } = await import("@/store/auth");
const { routesService } = await import("@/services/routes");
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

const ROUTE = { id: "r1", projectId: "p1", name: "Orders", method: "GET", path: "/orders" };

function setRole(role: "viewer" | "creator") {
	authStore.setState((s) => {
		s.state.acl = { p1: role };
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
	});
}

function renderControls(options: {
	uncommitted: boolean;
	unsaved?: boolean;
	saveChanges?: () => Promise<boolean>;
}) {
	spyOn(routesService, "getById").mockResolvedValue({
		...ROUTE,
		headVersionNumber: 1,
		uncommitted: options.uncommitted,
	} as never);
	const openHistory = mock(() => undefined);
	const saveChanges = mock(options.saveChanges ?? (async () => true));
	const view = render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<CommitControls
				kind="route"
				id="r1"
				projectId="p1"
				canvas={{ hasUnsavedChanges: options.unsaved ?? false, saveChanges }}
				onOpenHistory={openHistory}
			/>
		</QueryClientProvider>,
	);
	return { view, openHistory, saveChanges };
}

const commitButton = (view: ReturnType<typeof render>) =>
	view.getByRole("button", { name: /Commit/ }) as HTMLButtonElement;

beforeEach(() => setRole("creator"));

test("the dot shows only while there are uncommitted changes", async () => {
	const changed = renderControls({ uncommitted: true });
	await until(() => changed.view.getByRole("img", { name: "Uncommitted changes" }));
	expect(commitButton(changed.view).disabled).toBe(false);
	cleanup();

	const clean = renderControls({ uncommitted: false });
	await act(() => new Promise((r) => setTimeout(r, 60)));
	expect(clean.view.queryByRole("img", { name: "Uncommitted changes" })).toBeNull();
});

test("with nothing to commit the button is disabled", async () => {
	const { view } = renderControls({ uncommitted: false });
	await act(() => new Promise((r) => setTimeout(r, 60)));
	expect(commitButton(view).disabled).toBe(true);
});

test("a title is required, then commit posts it and says which version it made", async () => {
	const commit = spyOn(versionsService, "commit").mockResolvedValue({
		id: "v1",
		versionNumber: 4,
	} as never);
	const success = spyOn(toast, "success").mockImplementation((() => "") as never);
	const { view } = renderControls({ uncommitted: true });
	await until(() => view.getByRole("img", { name: "Uncommitted changes" }));
	fireEvent.click(commitButton(view));

	const submit = await until(() => {
		const buttons = [...document.body.querySelectorAll("button")];
		const found = buttons.find((b) => b.textContent?.trim() === "Commit" && b.type === "submit");
		if (!found) throw new Error("no submit");
		return found as HTMLButtonElement;
	});
	expect(submit.disabled).toBe(true);

	const title = document.body.querySelector(
		'input[type="text"], input:not([type])',
	) as HTMLInputElement;
	fireEvent.change(title, { target: { value: "  Add rate limiting  " } });
	const description = document.body.querySelector("textarea") as HTMLTextAreaElement;
	fireEvent.change(description, { target: { value: "Per key" } });
	await until(() => expect(submit.disabled).toBe(false));
	fireEvent.click(submit);

	await until(() => expect(commit).toHaveBeenCalled());
	expect(commit).toHaveBeenCalledWith("route", "r1", {
		title: "Add rate limiting",
		description: "Per key",
	});
	await until(() => expect(success).toHaveBeenCalledWith("Committed v4"));
});

/** the dialog's submit button, whichever label it carries */
const submitButton = () =>
	[...document.body.querySelectorAll("form button")].find(
		(b) => (b as HTMLButtonElement).type === "submit",
	) as HTMLButtonElement;

async function fillTitle(value: string) {
	const input = (await until(() => {
		const found = document.body.querySelector("input");
		if (!found) throw new Error("no title box");
		return found;
	})) as HTMLInputElement;
	fireEvent.change(input, { target: { value } });
}

test("unsaved edits are saved first, then committed, in one step", async () => {
	const order: string[] = [];
	const commit = spyOn(versionsService, "commit").mockImplementation((async () => {
		order.push("commit");
		return { id: "v1", versionNumber: 2 };
	}) as never);
	const { view, saveChanges } = renderControls({
		uncommitted: false,
		unsaved: true,
		saveChanges: async () => {
			order.push("save");
			return true;
		},
	});
	// edits on the canvas are work too, so the button is live
	await until(() => expect(commitButton(view).disabled).toBe(false));
	fireEvent.click(commitButton(view));

	await fillTitle("Rate limit");
	await until(() => expect(submitButton().textContent).toContain("Save and commit"));
	expect(document.body.textContent).toContain("they are saved first");
	expect(saveChanges).not.toHaveBeenCalled();
	fireEvent.click(submitButton());

	await until(() => expect(commit).toHaveBeenCalled());
	expect(order).toEqual(["save", "commit"]);
});

test("a save that fails commits nothing", async () => {
	const commit = spyOn(versionsService, "commit").mockResolvedValue({} as never);
	const { view, saveChanges } = renderControls({
		uncommitted: true,
		unsaved: true,
		saveChanges: async () => false,
	});
	await until(() => view.getByRole("img", { name: "Uncommitted changes" }));
	fireEvent.click(commitButton(view));
	await fillTitle("Rate limit");
	await until(() => expect(submitButton().disabled).toBe(false));
	fireEvent.click(submitButton());

	await until(() => expect(saveChanges).toHaveBeenCalled());
	await act(() => new Promise((r) => setTimeout(r, 40)));
	expect(commit).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain("Commit a version");
});

test("the caret menu opens the history", async () => {
	const { view, openHistory } = renderControls({ uncommitted: true });
	fireEvent.click(view.getByRole("button", { name: "Version options" }));
	fireEvent.click(await until(() => view.getByRole("menuitem", { name: "Version history" })));
	expect(openHistory).toHaveBeenCalled();
});

test("a viewer has no Commit, but can open the history", async () => {
	setRole("viewer");
	const { view, openHistory } = renderControls({ uncommitted: true });
	await act(() => new Promise((r) => setTimeout(r, 40)));
	expect(view.queryByRole("button", { name: /Commit/ })).toBeNull();
	fireEvent.click(view.getByRole("button", { name: /Version history/ }));
	expect(openHistory).toHaveBeenCalled();
});
