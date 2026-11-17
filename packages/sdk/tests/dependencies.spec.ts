import { describe, expect, it } from "bun:test";
import { block, fluxifyManifestSchema, grantIssues, param, toManifestEntry } from "../blocks";

/** a block of `acme/t` asking for `integrations`, its param picking the first of them, of `variants` */
const using = (integrations: string[], variants?: string[]) => {
	const kind = integrations[0]!;
	const b = block({
		name: "acme/t/use",
		label: "Use",
		permissions: { integrations },
		params: { conn: param.integration({ kind, ...(variants && { variants }) }) },
		async run() {
			return { output: null };
		},
	});
	return { ...toManifestEntry(b), entry: "dist/blocks/use.js" };
};

const manifest = (b: object, dependencies?: object[]) => ({
	name: "acme/t",
	url: "https://x.dev",
	sdk: ">=2026.10.2001",
	blocks: { "acme/t/use": b },
	...(dependencies && { dependencies }),
});

const CRM = { name: "@other/crm", plugin: "other/crm", range: "^1.0.0" };
/** the manifest of the dependency, as the CLI reads it from node_modules */
const crmManifest = { integrations: [{ group: "other/crm", variant: "Hub" }] };

const messages = (m: object) =>
	fluxifyManifestSchema.safeParse(m).error?.issues.map((i) => i.message) ?? [];

describe("manifest dependencies (#899)", () => {
	it("parses a dependency list, and refuses a bad name, a duplicate and itself", () => {
		expect(messages(manifest(using(["kv"]), [CRM]))).toEqual([]);
		expect(messages(manifest(using(["kv"]), [{ ...CRM, name: "Not A Package" }]))[0]).toContain(
			"npm package name",
		);
		expect(messages(manifest(using(["kv"]), [CRM, CRM]))).toEqual(["each plugin is a dependency once"]);
		expect(messages(manifest(using(["kv"]), [{ ...CRM, plugin: "acme/t" }]))).toEqual([
			"a plugin cannot depend on itself",
		]);
	});

	it("leaves another plugin's groups to the full check when the dependencies are not at hand", () => {
		// no dependency declared: refused outright
		expect(messages(manifest(using(["other/crm"])))[0]).toContain("add that plugin to peerDependencies");
		// declared: the admin parsing it alone cannot tell, so it is accepted here
		expect(messages(manifest(using(["other/crm"], ["Hub"]), [CRM]))).toEqual([]);
	});

	it("the full check accepts the dependencies' groups and variants, and nothing else", () => {
		const m = (b: object) => fluxifyManifestSchema.parse(manifest(b, [CRM]));
		expect(grantIssues(m(using(["other/crm", "other/crm/Hub"], ["Hub"])), [crmManifest])).toEqual([]);
		expect(grantIssues(m(using(["other/billing"])), [crmManifest])[0]?.message).toContain(
			"(other/crm)",
		);
		expect(grantIssues(m(using(["other/crm"], ["Nope"])), [crmManifest])[0]?.message).toBe(
			"param 'conn': 'Nope' is not a variant of other/crm; known: Hub",
		);
		// its dependency gone from node_modules: nothing of it may be used
		expect(grantIssues(m(using(["other/crm"])), [])).toHaveLength(1);
	});
});
