import { describe, expect, it } from "bun:test";
import { block, fluxifyManifestSchema, grantIssues, param, toManifestEntry } from "../blocks";
import { integration, toIntegrationEntry } from "../integrations";

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
const crmManifest = { name: "other/crm", integrations: [{ group: "other/crm", variant: "Hub" }] };

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

/** acme/t's variant `variant` of `group`, as its manifest lists it */
const adding = (group: string, variant = "Pipe") => ({
	...toIntegrationEntry(
		integration({
			name: "acme/t/pipe",
			label: "Pipe",
			icon: "./pipe.svg",
			group,
			variant,
			config: {},
			connect: () => ({}),
		}),
	),
	entry: "dist/integrations/pipe.js",
});

describe("a variant of a dependency's group (#899)", () => {
	const withVariant = (group: string, b = using(["kv"]), dependencies: object[] = [CRM], variant?: string) =>
		fluxifyManifestSchema.parse({ ...manifest(b, dependencies), integrations: [adding(group, variant)] });

	it("integration() keeps the dependency's group as written", () => {
		expect(adding("other/crm").group).toBe("other/crm");
		expect(adding("crm").group).toBe("acme/crm");
	});

	it("is accepted in a dependency's group, and the plugin's own blocks can use and list it", () => {
		const m = withVariant("other/crm", using(["other/crm", "other/crm/Pipe"], ["Hub", "Pipe"]));
		expect(grantIssues(m, [crmManifest])).toEqual([]);
	});

	it("refuses a group of a plugin it does not depend on, even without the dependencies at hand", () => {
		const parsed = fluxifyManifestSchema.safeParse({
			...manifest(using(["kv"])),
			integrations: [adding("other/crm")],
		});
		expect(parsed.error?.issues.map((i) => i.message)).toEqual([
			"group 'other/crm' is not a group of a plugin this one depends on: add the plugin that declares it to peerDependencies",
		]);
	});

	it("refuses a group the dependency does not declare, and a variant it already provides", () => {
		expect(grantIssues(withVariant("other/billing"), [crmManifest])).toEqual([
			{
				message: "plugin other/crm declares no integration group 'other/billing' (other/crm)",
				path: ["integrations", 0, "group"],
			},
		]);
		expect(grantIssues(withVariant("other/crm", undefined, [CRM], "hub"), [crmManifest])).toEqual([
			{
				message: "variant 'hub' of other/crm is already provided by plugin other/crm",
				path: ["integrations", 0, "variant"],
			},
		]);
	});

	it("a dependency's dependency is not a direct dependency: its groups stay out", () => {
		// relay/sync depends on other/crm and adds a variant to it; acme/t depends only on relay/sync
		const sync = { name: "relay/sync", integrations: [{ group: "other/crm", variant: "Sync" }] };
		const deps = [{ name: "@relay/sync", plugin: "relay/sync", range: "^1.0.0" }];
		const extending = fluxifyManifestSchema.safeParse({
			...manifest(using(["kv"]), deps),
			integrations: [adding("other/crm")],
		});
		expect(extending.error?.issues[0]?.message).toContain(
			"group 'other/crm' is not a group of a plugin this one depends on",
		);
		// nor can it use that group
		const m = fluxifyManifestSchema.parse(manifest(using(["other/crm"]), deps));
		expect(grantIssues(m, [sync])[0]?.message).toContain("is not an integration group of this plugin");
	});
});

