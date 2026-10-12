import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { VersionList } = await import("./VersionList");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const version = (n: number) => ({
	id: `v${n}`,
	kind: "custom_block" as const,
	targetId: "b1",
	versionNumber: n,
	title: `Title ${n}`,
	description: null,
	author: "Ada",
	authorEmail: "ada@x.io",
	createdAt: "2026-10-01T10:00:00.000Z",
	parentId: null,
	isHead: false,
	isProd: false,
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

function mount(kind: "route" | "workflow" | "custom_block" | "middleware") {
	return render(
		<VersionList
			kind={kind}
			versions={[version(2), version(1)]}
			uncommitted={false}
			selectedId={undefined}
			canEdit
			liveVersionNumber={null}
			onSelect={() => {}}
			onOpenCanvas={() => {}}
			onAction={() => {}}
		/>,
	);
}

const menuitem = (name: string) => {
	const found = [...document.body.querySelectorAll('[role="menuitem"]')].find(
		(el) => el.textContent?.trim() === name,
	);
	if (!found) throw new Error(`no menuitem ${name}`);
	return found;
};
const hasMenuItem = (name: string) =>
	[...document.body.querySelectorAll('[role="menuitem"]')].some(
		(el) => el.textContent?.trim() === name,
	);

async function openMenu() {
	const trigger = [...document.body.querySelectorAll("button")].find(
		(b) => b.getAttribute("aria-label") === "v2 options",
	);
	if (!trigger) throw new Error("no menu trigger");
	fireEvent.click(trigger);
	return until(() => menuitem("Copy version id"));
}

test("a custom block's version menu offers promote, check out and copy id, but no sandbox or recordings", async () => {
	mount("custom_block");
	await openMenu();
	expect(hasMenuItem("Check out")).toBe(true);
	expect(hasMenuItem("Promote to production")).toBe(true);
	expect(hasMenuItem("Copy version id")).toBe(true);
	expect(hasMenuItem("Open in sandbox")).toBe(false);
	expect(hasMenuItem("View recordings")).toBe(false);
});

test("a middleware's version menu is the same, without sandbox or recordings", async () => {
	mount("middleware");
	await openMenu();
	expect(hasMenuItem("Promote to production")).toBe(true);
	expect(hasMenuItem("Open in sandbox")).toBe(false);
	expect(hasMenuItem("View recordings")).toBe(false);
});

test("a route still offers sandbox and recordings", async () => {
	mount("route");
	await openMenu();
	expect(hasMenuItem("Open in sandbox")).toBe(true);
	expect(hasMenuItem("View recordings")).toBe(true);
});
