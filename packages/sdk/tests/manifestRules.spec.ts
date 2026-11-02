import { describe, expect, it } from "bun:test";
import { fluxifyManifestSchema } from "../src/manifest.js";

// `fluxify.json` as a hand edit leaves it: the per-entry rules must hold on the
// whole manifest (what the server parses), not only on one entry (what the CLI parses).
const base = { name: "acme/x", url: "https://x.dev", sdk: ">=1.0.0", blocks: {} };
const block = (over: object) => ({
	"acme/x/b": {
		name: "acme/x/b",
		label: "B",
		shape: "square",
		invoke: ["sync"],
		permissions: {},
		params: {},
		handles: { in: ["target"], out: ["source"], body: [] },
		deprecated: null,
		entry: "dist/blocks/b.js",
		...over,
	},
});
const trigger = (over: object) => ({
	name: "acme/x/t",
	label: "T",
	icon: "t.svg",
	permissions: {},
	params: {},
	retry: false,
	entry: "dist/triggers/t.js",
	...over,
});
const integration = (over: object) => ({
	name: "acme/x/i",
	label: "I",
	icon: "i.svg",
	group: "acme/g",
	variant: "v",
	configSchema: {},
	secretParams: [],
	hasTest: false,
	hasDescribe: false,
	hasInspect: false,
	entry: "dist/integrations/i.js",
	...over,
});
const problems = (over: object) => {
	const parsed = fluxifyManifestSchema.safeParse({ ...base, ...over });
	return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
};
const appconfig = { k: { type: "appconfig" } };
const kv = { k: { type: "integration", kind: "kv" } };

describe("fluxifyManifestSchema applies each entry's rules", () => {
	it("takes entries that keep them, with their `entry`", () => {
		expect(
			problems({
				blocks: block({ params: appconfig, permissions: { appconfig: true } }),
				triggers: [trigger({ params: { k: { type: "secret" } } })],
				integrations: [integration({ configSchema: { s: { type: "secret" } }, secretParams: ["s"] })],
			}),
		).toEqual([]);
	});

	it("refuses a block's appconfig or integration param without its permission", () => {
		expect(problems({ blocks: block({ params: appconfig }) })).toEqual([
			"param 'k' reads app config, so permissions.appconfig must be true",
		]);
		expect(problems({ blocks: block({ params: kv }) })).toEqual([
			"param 'k' picks a kv integration, so permissions.integrations must list 'kv'",
		]);
	});

	it("refuses a trigger's appconfig or integration param without its permission", () => {
		expect(problems({ triggers: [trigger({ params: appconfig })] })).toEqual([
			"param 'k' reads app config, so permissions.appconfig must be true",
		]);
		expect(problems({ triggers: [trigger({ params: kv })] })).toEqual([
			"param 'k' picks a kv integration, so permissions.integrations must list 'kv'",
		]);
	});

	it("refuses an integration's appconfig config and wrong secretParams", () => {
		expect(problems({ integrations: [integration({ configSchema: appconfig })] })).toEqual([
			expect.stringContaining("reads app config through param.secret()"),
		]);
		expect(problems({ integrations: [integration({ secretParams: ["s"] })] })).toEqual([
			expect.stringContaining("secretParams must be the secret params"),
		]);
	});

	it("still refuses an unknown field on an entry", () => {
		expect(problems({ triggers: [trigger({ surprise: 1 })] })).toEqual([
			expect.stringContaining("surprise"),
		]);
	});
});
