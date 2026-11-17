// Removing or upgrading a plugin other plugins depend on (#899 part 3): the
// removal gate, and each way an upgrade of a dependency breaks a dependent.
import { describe, expect, it } from "bun:test";
import { param } from "@fluxify/sdk/blocks";
import { toIntegrationEntry } from "@fluxify/sdk/integrations";
import {
	DependentsError,
	removalDependents,
	upgradeBlockers,
	variantsAddedTo,
} from "../dependencyGates";
import type { PluginRow } from "../meta";
import { entry, manifest } from "./fixtures";

const CRM = "acme/crm";
const GROUP = "acme/crm";

const variant = (plugin: string, name: string, group = GROUP) => ({
	...toIntegrationEntry({
		name: `${plugin}/${name.toLowerCase()}`,
		label: name,
		icon: "data:image/svg+xml,x",
		group,
		variant: name,
		config: { token: param.secret({ required: true }) },
		connect: () => ({}),
	} as never),
	entry: `dist/integrations/${name.toLowerCase()}.js`,
});

type Opts = {
	version?: string;
	variants?: [string, string?][];
	deps?: Record<string, string>;
	/** the kinds its one block lists in `permissions.integrations`, and an integration param's `kind` and `variants` */
	uses?: string[];
	param?: { kind: string; variants?: string[] };
	over?: Partial<PluginRow>;
};

/** approved and on everywhere unless `over` says otherwise */
const row = (name: string, o: Opts = {}): PluginRow =>
	({
		name,
		version: o.version ?? "1.0.0",
		integrity: `sha-${name}-${o.version ?? "1.0.0"}`,
		approval: "approved",
		devEnabled: true,
		prodEnabled: true,
		manifest: {
			...manifest(name, [
				entry(`${name}/step`, {
					permissions: { integrations: o.uses ?? [] },
					params: o.param ? { conn: { type: "integration", ...o.param } } : {},
				}),
			]),
			integrations: (o.variants ?? []).map(([n, g]) => variant(name, n, g)),
			...(o.deps && {
				dependencies: Object.entries(o.deps).map(([plugin, range]) => ({
					name: `@${plugin}`,
					plugin,
					range,
				})),
			}),
		},
		...o.over,
	}) as unknown as PluginRow;

const crm = (o: Opts = {}) => row(CRM, { variants: [["Hub"], ["Cloud"]], ...o });
const sales = (o: Opts = {}) => row("acme/sales", { deps: { [CRM]: "^1.0.0" }, ...o });
/** the pending upgrade of `current` to `next`'s manifest and version */
const upgrading = (current: PluginRow, next: PluginRow): PluginRow => ({
	...next,
	approval: "pending",
	live: { ...current, source: "npm", location: "x", permissions: null } as never,
});
const blockers = (next: PluginRow, current: PluginRow, rows: PluginRow[]) =>
	upgradeBlockers(upgrading(current, next), current.manifest, [...rows, upgrading(current, next)]);

describe("removing a plugin others depend on", () => {
	it("lists the approved dependents by name and version, and none for a pending or rejected one", () => {
		const rows = [crm(), sales({ version: "1.4.0" })];
		expect(removalDependents(rows, CRM)).toEqual([{ plugin: "acme/sales", version: "1.4.0", range: "^1.0.0" }]);
		expect(removalDependents([crm(), sales({ over: { approval: "pending" } })], CRM)).toEqual([]);
		expect(removalDependents([crm(), sales({ over: { approval: "rejected" } })], CRM)).toEqual([]);
		expect(removalDependents(rows, "acme/sales")).toEqual([]);
	});

	it("reads a dependent as it loads: its pending upgrade that dropped the dependency changes nothing yet", () => {
		const old = sales();
		const dropped = upgrading(old, row("acme/sales", { version: "2.0.0" }));
		expect(removalDependents([crm(), dropped], CRM).map((d) => d.version)).toEqual(["1.0.0"]);
	});

	it("names every dependent in the 409, with the integrations on their variants", () => {
		const error = new DependentsError(
			CRM,
			[
				{ plugin: "acme/sales", version: "1.0.0", range: "^1.0.0" },
				{ plugin: "acme/pipe", version: "2.0.0", range: "*" },
			],
			[{ id: "i1", name: "pipe-main", group: GROUP, variant: "Pipe" }],
		);
		expect(error.message).toBe(
			`Plugin ${CRM} cannot be removed: acme/sales@1.0.0 (needs ^1.0.0), acme/pipe@2.0.0 (needs *) depend on it. Remove those plugins first.`,
		);
		expect(error.details).toMatchObject({ integrations: [{ name: "pipe-main" }] });
	});

	it("finds the variants dependents add inside its groups, and no others", () => {
		const pipe = row("acme/pipe", { variants: [["Pipe"], ["Mail", "acme/mail"]], deps: { [CRM]: "^1.0.0" } });
		const kinds = variantsAddedTo([crm(), pipe, sales()], crm()).flatMap((m) =>
			m.integrations.map((e) => `${e.group}/${e.variant}`),
		);
		expect(kinds).toEqual([`${GROUP}/Pipe`]);
	});
});

describe("upgrading a plugin others depend on", () => {
	const next = (o: Opts = {}) => crm({ version: "1.5.0", ...o });

	it("blocks nothing when the dependent's range and uses still hold", () => {
		const uses = sales({ uses: [`${GROUP}/Hub`], param: { kind: GROUP, variants: ["Hub"] } });
		expect(blockers(next(), crm(), [uses])).toEqual([]);
	});

	it("blocks a version outside an approved dependent's range, naming it", () => {
		expect(blockers(next({ version: "2.0.0" }), crm(), [sales({ version: "1.2.0" })])).toEqual([
			`plugin acme/sales@1.2.0 needs ${CRM} ^1.0.0, and version 2.0.0 is outside it`,
		]);
	});

	it("blocks dropping a group a dependent uses in its permissions", () => {
		const gone = next({ variants: [] });
		expect(blockers(gone, crm(), [sales({ uses: [GROUP] })])).toEqual([
			`plugin acme/sales@1.0.0 uses integration group ${GROUP}, which ${CRM}@1.5.0 drops`,
		]);
	});

	it("blocks dropping a variant a dependent names: in permissions, an integration param's kind, or its variants", () => {
		const lost = next({ variants: [["Cloud"]] });
		const named = (o: Opts) => blockers(lost, crm(), [sales(o)]);
		const line = `plugin acme/sales@1.0.0 uses integration variant ${GROUP}/Hub, which ${CRM}@1.5.0 drops`;
		expect(named({ uses: [`${GROUP}/Hub`] })).toEqual([line]);
		expect(named({ param: { kind: `${GROUP}/Hub` } })).toEqual([line]);
		expect(named({ param: { kind: GROUP, variants: ["Cloud", "Hub"] } })).toEqual([line]);
		expect(named({ uses: [`${GROUP}/Cloud`], param: { kind: GROUP, variants: ["Cloud"] } })).toEqual([]);
	});

	it("blocks dropping a group a dependent adds variants to, even one it does not otherwise use", () => {
		const pipe = row("acme/pipe", { variants: [["Pipe"]], deps: { [CRM]: "^1.0.0" } });
		expect(blockers(next({ variants: [] }), crm(), [pipe])).toEqual([
			`plugin acme/pipe@1.0.0 adds its variant Pipe to integration group ${GROUP}, which ${CRM}@1.5.0 drops`,
		]);
		// dropping one variant while the group stays breaks neither the dependent's variant nor its use of its own
		expect(blockers(next({ variants: [["Cloud"]] }), crm(), [pipe])).toEqual([]);
	});

	it("blocks adding a variant a dependent already provides in that group", () => {
		const pipe = row("acme/pipe", { variants: [["Pipe"]], deps: { [CRM]: "^1.0.0" } });
		expect(blockers(next({ variants: [["Hub"], ["Cloud"], ["Pipe"]] }), crm(), [pipe])).toEqual([
			`Plugin ${CRM} provides integration variant ${GROUP}/Pipe, which plugin acme/pipe already provides in this project`,
		]);
	});

	it("reads a dependent with an upgrade waiting by that upgrade, so two that need each other can be approved", () => {
		const old = sales();
		const wants2 = upgrading(old, sales({ version: "2.0.0", deps: { [CRM]: "^2.0.0" } }));
		expect(blockers(next({ version: "2.0.0" }), crm(), [wants2])).toEqual([]);
		// ... while its old version, still loaded, would have refused
		expect(blockers(next({ version: "2.0.0" }), crm(), [old])).toHaveLength(1);
	});

	it("ignores a dependent that is not approved, or depends on something else", () => {
		const bad = next({ version: "2.0.0", variants: [] });
		expect(blockers(bad, crm(), [sales({ over: { approval: "rejected" } }), sales({ over: { approval: "pending" } })])).toEqual([]);
		expect(blockers(bad, crm(), [row("acme/other", { deps: { "acme/x": "*" }, uses: [GROUP] })])).toEqual([]);
	});
});
