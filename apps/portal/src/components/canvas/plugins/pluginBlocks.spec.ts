import { expect, test } from "bun:test";
import { slack as plugin } from "./fixtures";
import { pluginBlocksFrom } from "./PluginBlocksContext";
import {
	isPluginType,
	pluginBlockData,
	pluginBlockDefs,
	pluginHandleSpecs,
	pluginRows,
} from "./pluginBlocks";
import { agent, legacy, post, search } from "./fixtures";

const live = (blocks: object[]) => ({
	version: "1.0.0",
	integrity: "sha512-live",
	source: "npm" as const,
	location: "x",
	permissions: null,
	manifest: plugin(blocks).manifest,
});

test("plugin types are the ones with a path; builtin and custom names have none", () => {
	expect(isPluginType("acme/slack/messages/post")).toBe(true);
	expect(isPluginType("httprequest")).toBe(false);
	expect(isPluginType("my_custom_block")).toBe(false);
	expect(isPluginType(null)).toBe(false);
});

test("a canvas may hold blocks of any plugin that is not rejected, as the version that loads", () => {
	const defs = pluginBlockDefs([
		plugin([post]),
		plugin([legacy], { name: "acme/new", approval: "pending" }),
		plugin([search], { name: "acme/gone", approval: "rejected" }),
		plugin([agent], { name: "acme/up", approval: "pending", live: live([post]) }),
	]);

	// approved: loads. brand new and pending: drawn, but not offered. rejected: gone.
	// an upgrade still waiting: its approved version's blocks, not the new ones
	expect(defs.map((d) => [d.type, d.loads])).toEqual([
		[post.name, true],
		[legacy.name, false],
		[post.name, true],
	]);
});

test("handle specs are keyed by block type", () => {
	const specs = pluginHandleSpecs(pluginBlockDefs([plugin([agent, post])]));
	expect(Object.keys(specs)).toEqual([agent.name, post.name]);
	expect(specs[agent.name]?.body.map((b) => b.name)).toEqual(["tools", "memory", "approval"]);
});

test("the tree goes scope, plugin, folder, block; folders first, deprecated blocks last", () => {
	const defs = pluginBlockDefs([plugin([post, legacy, search]), plugin([agent], { name: "acme/agent" })]);
	const shape = (path: string) =>
		pluginRows(defs, path).map((r) =>
			r.kind === "folder" ? `${r.level}:${r.name}(${r.blocks})` : `block:${r.def.label}`,
		);

	expect(shape("")).toEqual(["scope:acme(4)"]);
	expect(shape("acme")).toEqual(["plugin:agent(1)", "plugin:slack(3)"]);
	expect(shape("acme/slack")).toEqual(["folder:messages(2)", "block:Search"]);
	expect(shape("acme/slack/messages")).toEqual(["block:Post message", "block:Old post"]);
	// a block straight under its plugin
	expect(shape("acme/agent")).toEqual(["block:Run agent"]);
});

test("a path is a whole segment: acme/slack does not open acme/slack2", () => {
	const defs = pluginBlockDefs([plugin([{ ...post, name: "acme/slack2/x/y" }])]);
	expect(pluginRows(defs, "acme/slack")).toEqual([]);
});

test("a new block starts with an invocation mode its manifest allows", () => {
	const [run, posted] = pluginBlockDefs([plugin([agent, post])]);
	expect(pluginBlockData(run!)).toEqual({ invoke: "async" });
	expect(pluginBlockData(posted!)).toEqual({ invoke: "sync" });
});

test("a plugin list that is not a list leaves the canvas without plugin blocks", () => {
	for (const data of [undefined, null, {}, "oops"]) {
		expect(pluginBlocksFrom(data, false).defs).toEqual([]);
	}
	expect(pluginBlocksFrom(undefined, true).isLoading).toBe(true);
	expect(pluginBlocksFrom([plugin([post])], false).byType[post.name]?.label).toBe("Post message");
});
