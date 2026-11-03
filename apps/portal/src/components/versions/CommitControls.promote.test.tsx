import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// canvas-confetti paints a canvas, which a test DOM has none of
mock.module("canvas-confetti", () => ({ default: mock(() => undefined) }));

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { authStore } = await import("@/store/auth");
const { routesService } = await import("@/services/routes");
const { versionsService } = await import("@/services/versions");
const { deploymentsService } = await import("@/services/deployments");
const { CommitControls } = await import("./CommitControls");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => mock.restore());

/** Not RTL's waitFor: it stays bound to the DOM of whichever test file loaded RTL first. */
async function until<T>(check: () => T, timeout = 2500): Promise<T> {
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

const version = (n: number, live: number) => ({
	id: `version-${n}`,
	kind: "route" as const,
	targetId: "r1",
	versionNumber: n,
	title: `Title ${n}`,
	description: null,
	author: "Ada",
	authorEmail: "ada@x.io",
	createdAt: "2026-10-01T10:00:00.000Z",
	parentId: null,
	isHead: n === 3,
	isProd: n === live,
});
/** newest first, as the server sends them; `live` is the one production serves */
const history = (live: number) => ({
	versions: [version(3, live), version(2, live), version(1, live)],
	uncommitted: false,
});

function setRole(role: "viewer" | "creator") {
	authStore.setState((s) => {
		s.state.acl = { p1: role };
		s.state.userData = { id: "u", name: "U", email: "u@x.io", isSystemAdmin: false };
	});
}

function renderControls() {
	spyOn(routesService, "getById").mockResolvedValue({
		id: "r1",
		projectId: "p1",
		name: "Orders",
		method: "GET",
		path: "/orders",
		headVersionNumber: 3,
		uncommitted: false,
	} as never);
	const openHistory = mock(() => undefined);
	const view = render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<CommitControls
				kind="route"
				id="r1"
				projectId="p1"
				canvas={{ hasUnsavedChanges: false, saveChanges: async () => true }}
				onOpenHistory={openHistory}
			/>
		</QueryClientProvider>,
	);
	return { view, openHistory };
}

const openMenu = (view: ReturnType<typeof render>) =>
	fireEvent.click(view.getByRole("button", { name: "Version options" }));
const row = (view: ReturnType<typeof render>, n: number) =>
	until(() => view.getByRole("menuitem", { name: new RegExp(`v${n}\\b`) }));

beforeEach(() => setRole("creator"));

// #1075: the versions sit in the menu, under Version history
test("the menu lists every version under Version history, the live one green", async () => {
	spyOn(versionsService, "list").mockResolvedValue(history(2) as never);
	const { view } = renderControls();
	openMenu(view);
	await row(view, 3);

	const names = view.getAllByRole("menuitem").map((item) => item.textContent?.trim());
	expect(names).toEqual(["Version history", "v3Title 3", "v2Title 2", "v1Title 1"]);

	const live = await row(view, 2);
	expect(live.className).toContain("bg-success/10");
	expect(live.querySelector('[aria-label="In production"]')).toBeTruthy();
	// nothing to promote on the live one; the others offer it, and an older one a rollback
	expect(live.querySelector('[aria-label="Promote to prod"]')).toBeNull();
	expect((await row(view, 3)).querySelector('[aria-label="Promote to prod"]')).toBeTruthy();
	expect(
		(await row(view, 1)).querySelector('[aria-label="Roll back to this version"]'),
	).toBeTruthy();
	expect((await row(view, 3)).className).not.toContain("bg-success/10");
});

test("choosing the live version changes nothing and keeps the menu open", async () => {
	spyOn(versionsService, "list").mockResolvedValue(history(2) as never);
	const { view } = renderControls();
	openMenu(view);
	fireEvent.click(await row(view, 2));
	await act(() => new Promise((r) => setTimeout(r, 40)));
	expect(document.body.textContent).not.toContain("to production");
	expect(view.getAllByRole("menuitem").length).toBe(4);
});

test("a version is promoted from the menu, and then it is the green one", async () => {
	let live = 2;
	spyOn(versionsService, "list").mockImplementation((async () => history(live)) as never);
	const deploy = spyOn(deploymentsService, "deploy").mockImplementation((async () => {
		live = 3;
		return {
			id: "d1",
			kind: "route",
			targetId: "r1",
			versionId: "version-3",
			versionNumber: 3,
			action: "promote",
			description: "ship it",
			author: "Ada",
			authorEmail: "ada@x.io",
			status: "live",
			gates: [],
			createdAt: "2026-10-01T10:00:00.000Z",
			finishedAt: "2026-10-01T10:00:01.000Z",
		};
	}) as never);
	const { view } = renderControls();
	openMenu(view);
	fireEvent.click(await row(view, 3));

	// the same confirmation the history page asks: a description, then Promote
	await until(() => {
		if (!document.body.textContent?.includes("Promote v3 to production"))
			throw new Error("no dialog");
	});
	const description = await until(() => {
		const found = document.body.querySelector("textarea");
		if (!found) throw new Error("no description");
		return found as HTMLTextAreaElement;
	});
	fireEvent.change(description, { target: { value: "ship it" } });
	const promote = [...document.body.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === "Promote",
	) as HTMLButtonElement;
	await until(() => expect(promote.disabled).toBe(false));
	fireEvent.click(promote);
	await until(() => expect(deploy).toHaveBeenCalled());
	expect(deploy.mock.calls[0]?.slice(0, 3)).toEqual([
		"route",
		"r1",
		{ versionId: "version-3", description: "ship it" },
	]);

	// the history is read again once the checks settle, so v3 is the live one now
	await until(() => expect(document.body.textContent).toContain("v3 is live in production"));
	fireEvent.click(
		[...document.body.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Close",
		) as HTMLButtonElement,
	);
	openMenu(view);
	await until(async () => {
		expect((await row(view, 3)).className).toContain("bg-success/10");
	});
	expect((await row(view, 2)).className).not.toContain("bg-success/10");
});

test("a viewer cannot promote and the versions are not even asked for", async () => {
	setRole("viewer");
	const list = spyOn(versionsService, "list").mockResolvedValue(history(2) as never);
	const { view, openHistory } = renderControls();
	await act(() => new Promise((r) => setTimeout(r, 40)));
	expect(list).not.toHaveBeenCalled();
	fireEvent.click(view.getByRole("button", { name: /Version history/ }));
	expect(openHistory).toHaveBeenCalled();
});
