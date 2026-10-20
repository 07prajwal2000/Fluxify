import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();
const { cleanup, render } = await import("@testing-library/react");
const { blocksOf, post, slack } = await import("./fixtures");
const { pluginFolderItems } = await import("./pluginPicker");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const SLACK = "data:image/svg+xml;base64,c2xhY2s=";
const OLD_SCOPE = "data:image/svg+xml;base64,b2xk";
const NEW_SCOPE = "data:image/svg+xml;base64,bmV3";

/** the image each folder of one tree level shows, or `default` */
const icons = (defs: ReturnType<typeof blocksOf>["defs"], path: string) =>
	Object.fromEntries(
		pluginFolderItems(defs, path).map((item) => {
			const view = render(<>{item.icon}</>);
			const src = view.container.querySelector("img")?.getAttribute("src");
			const shown = src ?? (view.container.querySelector("svg") ? "default" : "none");
			cleanup();
			return [item.name, shown];
		}),
	);

const manifest = (name: string, over: object) => ({
	name,
	blocks: { [`${name}/x`]: { ...post, name: `${name}/x` } },
	...over,
});

test("a plugin folder shows the plugin's icon, else the default", () => {
	const { defs } = blocksOf(
		slack(undefined, { manifest: manifest("acme/slack", { icon: SLACK }) as never }),
		slack(undefined, { name: "acme/mail", manifest: manifest("acme/mail", {}) as never }),
	);
	expect(icons(defs, "acme")).toEqual({ mail: "default", slack: SLACK });
});

test("a scope folder shows the latest approved plugin's scopeIcon, else the default", () => {
	const older = slack(undefined, {
		approvedAt: "2026-10-01T00:00:00.000Z",
		manifest: manifest("acme/slack", { scopeIcon: OLD_SCOPE }) as never,
	});
	const newer = slack(undefined, {
		name: "acme/mail",
		approvedAt: "2026-10-20T00:00:00.000Z",
		manifest: manifest("acme/mail", { scopeIcon: NEW_SCOPE }) as never,
	});
	const silent = slack(undefined, {
		name: "acme/zip",
		approvedAt: "2026-10-21T00:00:00.000Z",
		manifest: manifest("acme/zip", {}) as never,
	});
	const other = slack(undefined, { name: "beta/one", manifest: manifest("beta/one", {}) as never });
	expect(icons(blocksOf(older, newer, silent, other).defs, "")).toEqual({
		acme: NEW_SCOPE,
		beta: "default",
	});
	expect(icons(blocksOf(older).defs, "")).toEqual({ acme: OLD_SCOPE });
});
