import { describe, expect, it } from "bun:test";
import { fluxifyManifestSchema, ICON_URL_MAX, plugin, pluginMetaSchema } from "../blocks.js";

const meta = { name: "acme/slack", url: "https://github.com/acme/fluxify-slack" };

describe("plugin()", () => {
	it("returns what it was given, icons and description included", () => {
		const full = { ...meta, icon: "./icons/slack.svg", scopeIcon: "./icons/acme.svg", description: "Slack blocks" };
		expect(plugin(full)).toEqual(full);
		expect(plugin(meta)).toEqual(meta);
	});

	it("refuses a bad name or url, naming the plugin", () => {
		expect(() => plugin({ ...meta, name: "slack" })).toThrow(/^plugin slack: .*scope\/name/s);
		expect(() => plugin({ ...meta, name: "Acme/Slack" })).toThrow("scope/name");
		expect(() => plugin({ ...meta, url: "http://example.com" })).toThrow("https://");
		expect(() => plugin({ name: "acme/slack" } as never)).toThrow("url");
	});

	it("refuses unknown fields, empty icons and icons over the custom block limit", () => {
		expect(() => plugin({ ...meta, colour: "red" } as never)).toThrow();
		expect(() => plugin({ ...meta, icon: "" })).toThrow();
		expect(() => plugin({ ...meta, scopeIcon: "a".repeat(ICON_URL_MAX + 1) })).toThrow();
		expect(() => plugin({ ...meta, scopeIcon: "a".repeat(ICON_URL_MAX) })).not.toThrow();
	});

	it("is the top of the manifest: the same rules", () => {
		expect(Object.keys(pluginMetaSchema.shape).sort()).toEqual(["description", "icon", "name", "scopeIcon", "url"]);
		for (const key of Object.keys(pluginMetaSchema.shape))
			expect(Object.keys(fluxifyManifestSchema.shape)).toContain(key);
	});
});

describe("fluxifyManifestSchema compatibility", () => {
	const block = {
		name: "acme/slack/post",
		entry: "dist/blocks/post.js",
		label: "Post",
		shape: "square",
		invoke: ["sync"],
		permissions: {},
		params: { channel: { type: "string", required: true }, n: { type: "number" } },
		handles: { in: ["target"], out: ["source"], body: [] },
		deprecated: null,
	};
	const old = { ...meta, sdk: ">=2026.10.2001", blocks: { [block.name]: block } };

	it("still takes a manifest with no plugin icons, description, tabs or order", () => {
		expect(fluxifyManifestSchema.parse(old)).toEqual(old as never);
	});

	it("takes the plugin's icons and description, and params with tab and order", () => {
		const params = { channel: { ...block.params.channel, tab: "Auth", order: 0 }, n: { ...block.params.n, order: 1 } };
		const next = {
			...old,
			icon: "icons/p.svg",
			scopeIcon: "icons/s.svg",
			description: "Slack",
			blocks: { [block.name]: { ...block, params, tabs: ["General", "Auth"] } },
		};
		expect(fluxifyManifestSchema.safeParse(next).success).toBe(true);
	});
});
