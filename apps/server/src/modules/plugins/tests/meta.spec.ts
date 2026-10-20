import { describe, expect, it } from "bun:test";
import { fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import { compileWithPlugins, type PluginSet } from "../compile";
import { blockMetaOf, isUsableIn, type PluginRow, requestedPermissions, unusableReason } from "../meta";
import { entry, graphCalling, manifest } from "./fixtures";

const TYPE = "acme/echo/step";
const row = (over: Partial<PluginRow> = {}): PluginRow => ({
	name: "acme/echo",
	version: "2026.10.2001",
	integrity: "sha256-a",
	approval: "approved",
	devEnabled: true,
	prodEnabled: false,
	manifest: fluxifyManifestSchema.parse(manifest()),
	...over,
});

describe("plugin metadata (#857)", () => {
	it("takes handles, invoke modes and schema params from a manifest block", () => {
		const parsed = fluxifyManifestSchema.parse(
			manifest("acme/echo", [
				entry(TYPE, {
					params: { shape: { type: "schema" }, n: { type: "number" }, map: { type: "fieldMap" } },
				}),
			]),
		);
		expect(blockMetaOf(parsed.blocks[TYPE]!)).toEqual({
			handles: { in: ["target"], out: ["success", "failure"], body: [] },
			invoke: ["sync"],
			schemaParams: ["shape"],
			fieldMapParams: ["map"],
		});
	});

	it("asks for every block's permissions together", () => {
		const parsed = fluxifyManifestSchema.parse(
			manifest("acme/echo", [
				entry("acme/echo/a", { permissions: { integrations: ["kv", "database"] } }),
				entry("acme/echo/b", { permissions: { integrations: ["kv"], appconfig: true } }),
			]),
		);
		expect(requestedPermissions(parsed)).toEqual({
			integrations: ["database", "kv"],
			appconfig: true,
		});
	});

	it("loads only approved and enabled in that environment, and says why not", () => {
		expect(isUsableIn(row(), "development")).toBe(true);
		expect(unusableReason(row(), "production")).toBe(
			"plugin acme/echo@2026.10.2001 is not enabled in production",
		);
		expect(unusableReason(row({ approval: "pending" }), "development")).toContain(
			"waiting for a creator to approve it",
		);
		expect(unusableReason(row({ approval: "rejected" }), "development")).toContain("was rejected");
	});
});

describe("compileWithPlugins", () => {
	const { blocks, edges } = graphCalling(TYPE);
	const meta = blockMetaOf(fluxifyManifestSchema.parse(manifest()).blocks[TYPE]!);

	it("compiles a usable plugin block and lists it for the worker", () => {
		const set: PluginSet = { blockMeta: { [TYPE]: meta }, unusable: new Map() };
		const { source, pluginBlocks } = compileWithPlugins(blocks, edges, {}, set);
		expect(source).toContain(`lib.invokeRouted(ctx, "${TYPE}"`);
		expect(pluginBlocks).toEqual([TYPE]);
	});

	it("fails naming the plugin when it may not load", () => {
		const set: PluginSet = {
			blockMeta: {},
			unusable: new Map([[TYPE, unusableReason(row({ approval: "pending" }), "development")!]]),
		};
		expect(() => compileWithPlugins(blocks, edges, {}, set)).toThrow(
			`Block ${TYPE} cannot run: plugin acme/echo@2026.10.2001 is waiting for a creator to approve it.`,
		);
	});
});
