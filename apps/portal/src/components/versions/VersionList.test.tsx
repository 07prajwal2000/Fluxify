import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { VersionList } = await import("./VersionList");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const version = (n: number, extra: object = {}) => ({
	id: `v${n}`,
	kind: "route" as const,
	targetId: "r1",
	versionNumber: n,
	title: `Title ${n}`,
	description: null,
	author: "Ada",
	authorEmail: "ada@x.io",
	createdAt: "2026-10-01T10:00:00.000Z",
	parentId: null,
	isHead: false,
	isProd: false,
	...extra,
});

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

function mount(
	versions: ReturnType<typeof version>[],
	canEdit = true,
	liveVersionNumber: number | null = null,
	uncommitted = false,
) {
	return render(
		<VersionList
			kind="route"
			versions={versions}
			uncommitted={uncommitted}
			selectedId={undefined}
			canEdit={canEdit}
			liveVersionNumber={liveVersionNumber}
			onSelect={() => {}}
			onOpenCanvas={() => {}}
			onAction={() => {}}
		/>,
	);
}

function row(n: number) {
	return [...document.body.querySelectorAll('ul[aria-label="Versions"] > li')].find((li) =>
		li.textContent?.includes(`v${n}`),
	)!;
}

async function openMenu(n: number) {
	const trigger = [...document.body.querySelectorAll("button")].find(
		(b) => b.getAttribute("aria-label") === `v${n} options`,
	);
	if (!trigger) throw new Error(`no menu trigger v${n}`);
	fireEvent.click(trigger);
	return until(() => menuitem("Copy version id"));
}

const menuitem = (name: string) => {
	const found = [...document.body.querySelectorAll('[role="menuitem"]')].find(
		(el) => el.textContent?.trim() === name,
	);
	if (!found) throw new Error(`no menuitem ${name}`);
	return found;
};
const queryMenuItem = (name: string) => {
	const found = [...document.body.querySelectorAll('[role="menuitem"]')].find(
		(el) => el.textContent?.trim() === name,
	);
	return found ?? null;
};

test("the head version carries a HEAD badge while the canvas is clean", () => {
	mount([version(2, { isHead: true }), version(1)]);
	expect(row(2).textContent).toContain("HEAD");
	expect(row(1).textContent).not.toContain("HEAD");
});

test("HEAD moves to the uncommitted row while there is uncommitted work", () => {
	mount([version(2, { isHead: true }), version(1)], true, null, true);
	// no version holds HEAD; the uncommitted row does
	expect(row(2).textContent).not.toContain("HEAD");
	const card = [...document.body.querySelectorAll("button")].find((b) =>
		b.textContent?.includes("Uncommitted changes"),
	)!;
	expect(card.textContent).toContain("HEAD");
	// and its "Open canvas" reads as a link
	const open = [...card.querySelectorAll("span")].find((s) => s.textContent === "Open canvas")!;
	expect(open.className).toContain("underline");
	expect(open.className).toContain("text-accent");
});

test("the live version carries an In production badge", () => {
	mount([version(2), version(1, { isProd: true })], true, 1);
	const items = [...document.body.querySelectorAll('ul[aria-label="Versions"] > li')];
	expect(items[1]?.textContent).toContain("In production");
	expect(items[0]?.textContent).not.toContain("In production");
});

test("a newer version is promoted", async () => {
	mount([version(2), version(1, { isProd: true })], true, 1);
	await openMenu(2);
	expect(menuitem("Promote to production")).toBeTruthy();
	expect(queryMenuItem("Roll back to this version")).toBeNull();
});

test("a version older than the live one rolls back", async () => {
	mount([version(3), version(2)], true, 3);
	await openMenu(2);
	expect(menuitem("Roll back to this version")).toBeTruthy();
	expect(queryMenuItem("Promote to production")).toBeNull();
});

test("the live version is offered neither", async () => {
	mount([version(2, { isProd: true }), version(1)], true, 2);
	await openMenu(2);
	expect(queryMenuItem("Promote to production")).toBeNull();
	expect(queryMenuItem("Roll back to this version")).toBeNull();
});

test("a viewer is offered none of the creator actions", async () => {
	mount([version(2), version(1, { isProd: true })], false, 1);
	await openMenu(2);
	expect(queryMenuItem("Promote to production")).toBeNull();
	expect(queryMenuItem("View recordings")).toBeNull();
	expect(menuitem("Copy version id")).toBeTruthy();
});
