import { describe, expect, it } from "bun:test";
import type { FluxifyManifest } from "@fluxify/sdk/blocks";
import {
	allDependentsOf,
	approvalBlockers,
	cycleWith,
	dependencyView,
	dependentsOf,
	inDependencyOrder,
	withDependencyGate,
} from "../dependencies";
import { isUsableIn, type PluginRow, unusableReason } from "../meta";
import { manifest } from "./fixtures";

/** plugin `name`@`version`, approved and on everywhere unless `over` says otherwise, depending on `deps` (plugin -> range) */
const row = (
	name: string,
	deps: Record<string, string> = {},
	over: Partial<PluginRow> = {},
): PluginRow => {
	const dependencies = Object.entries(deps).map(([plugin, range]) => ({
		name: `@${plugin}`,
		plugin,
		range,
	}));
	return {
		name,
		version: "1.0.0",
		integrity: `sha-${name}`,
		approval: "approved",
		devEnabled: true,
		prodEnabled: true,
		manifest: {
			...manifest(name),
			...(dependencies.length && { dependencies }),
		} as unknown as FluxifyManifest,
		...over,
	};
};

const gated = (rows: PluginRow[], name: string) => withDependencyGate(rows).find((r) => r.name === name)!;

describe("plugin dependency graph", () => {
	it("finds who depends on a plugin, directly and through another", () => {
		const rows = [row("x/crm"), row("x/sales", { "x/crm": "^1.0.0" }), row("x/report", { "x/sales": "*" })];
		expect(dependentsOf(rows, "x/crm").map((d) => [d.row.name, d.range])).toEqual([["x/sales", "^1.0.0"]]);
		expect(allDependentsOf(rows, "x/crm")).toEqual(["x/sales", "x/report"]);
		expect(allDependentsOf(rows, "x/report")).toEqual([]);
	});

	it("names a cycle a new version would close, with its path", () => {
		const rows = [row("x/a", { "x/b": "*" }), row("x/b")];
		expect(cycleWith(rows, row("x/b", { "x/a": "*" }).manifest)).toBe("x/b -> x/a -> x/b");
		expect(cycleWith(rows, row("x/c", { "x/a": "*" }).manifest)).toBeUndefined();
	});
});

describe("dependency order", () => {
	const order = (rows: PluginRow[]) => inDependencyOrder(rows).map((r) => r.name);

	it("puts a plugin after the plugins it depends on, and keeps the given order otherwise", () => {
		const rows = [row("x/report", { "x/sales": "*" }), row("x/sales", { "x/crm": "*" }), row("x/other"), row("x/crm")];
		expect(order(rows)).toEqual(["x/crm", "x/sales", "x/report", "x/other"]);
		expect(order([])).toEqual([]);
	});

	it("ignores a dependency the list does not hold, and keeps every member of a cycle", () => {
		expect(order([row("x/a", { "x/gone": "*" }), row("x/b")])).toEqual(["x/a", "x/b"]);
		expect(order([row("x/a", { "x/b": "*" }), row("x/b", { "x/a": "*" }), row("x/c")]).sort()).toEqual(["x/a", "x/b", "x/c"]);
	});
});

describe("approval gate", () => {
	it("refuses while a dependency is missing, out of range, pending or rejected", () => {
		const dependent = row("x/sales", { "x/crm": "^1.2.0" }, { approval: "pending" });
		const blockers = (crm?: Partial<PluginRow>) =>
			approvalBlockers(dependent, crm ? [dependent, row("x/crm", {}, crm)] : [dependent]);
		expect(blockers()).toEqual(["it needs plugin x/crm ^1.2.0, which is not installed"]);
		expect(blockers({ version: "1.0.0" })).toEqual(["it needs plugin x/crm ^1.2.0, but version 1.0.0 is installed"]);
		expect(blockers({ version: "1.3.0", approval: "pending" })).toEqual([
			"it needs plugin x/crm ^1.2.0, which is waiting for approval",
		]);
		expect(blockers({ version: "1.3.0", approval: "rejected" })).toEqual(["it needs plugin x/crm ^1.2.0, which was rejected"]);
		expect(blockers({ version: "1.3.0" })).toEqual([]);
	});
});

describe("load gate", () => {
	const crm = (over: Partial<PluginRow> = {}) => row("x/crm", {}, { version: "1.3.0", ...over });
	const sales = row("x/sales", { "x/crm": "^1.2.0" });

	it("lets a dependent load where its dependency loads", () => {
		const s = gated([crm(), sales], "x/sales");
		expect(s.blocked).toBeUndefined();
		expect(isUsableIn(s, "production")).toBe(true);
	});

	it("stops a dependent where its dependency is off, saying why the way a disabled plugin does", () => {
		const s = gated([crm({ prodEnabled: false }), sales], "x/sales");
		expect(isUsableIn(s, "development")).toBe(true);
		expect(isUsableIn(s, "production")).toBe(false);
		expect(unusableReason(s, "production")).toBe(
			"plugin x/sales@1.0.0 cannot load: it needs plugin x/crm ^1.2.0: plugin x/crm@1.3.0 is not enabled in production",
		);
	});

	it("stops it everywhere when the dependency is rejected, missing or out of range, and down the chain", () => {
		expect(gated([crm({ approval: "rejected" }), sales], "x/sales").blocked?.development).toBe(
			"it needs plugin x/crm ^1.2.0: plugin x/crm@1.3.0 was rejected",
		);
		expect(gated([sales], "x/sales").blocked?.production).toBe("it needs plugin x/crm ^1.2.0: it is not installed");
		expect(gated([crm({ version: "2.0.0" }), sales], "x/sales").blocked?.development).toBe(
			"it needs plugin x/crm ^1.2.0: version 2.0.0 is installed",
		);
		const report = row("x/report", { "x/sales": "*" });
		expect(isUsableIn(gated([crm({ approval: "rejected" }), sales, report], "x/report"), "development")).toBe(false);
	});

	it("reads the version that loads: a pending upgrade of the dependency changes nothing yet", () => {
		const upgrading = crm({
			version: "2.0.0",
			approval: "pending",
			live: { version: "1.3.0", integrity: "old", source: "npm", location: "@x/crm@1.3.0", manifest: crm().manifest, permissions: null },
		});
		expect(gated([upgrading, sales], "x/sales").blocked).toBeUndefined();
	});

	it("a disabled dependent keeps saying it is not enabled", () => {
		const s = gated([crm({ devEnabled: false }), row("x/sales", { "x/crm": "^1.2.0" }, { devEnabled: false })], "x/sales");
		expect(unusableReason(s, "development")).toBe("plugin x/sales@1.0.0 is not enabled in development");
	});
});

describe("dependencyView", () => {
	it("lists what a plugin depends on and what depends on it", () => {
		const rows = [row("x/crm", {}, { version: "1.0.0" }), row("x/sales", { "x/crm": "^1.2.0", "x/gone": "^1.0.0" })];
		expect(dependencyView(rows[1]!, rows).dependsOn).toEqual([
			{ plugin: "x/crm", package: "@x/crm", range: "^1.2.0", installed: { version: "1.0.0", approval: "approved" }, satisfied: false },
			{ plugin: "x/gone", package: "@x/gone", range: "^1.0.0", installed: null, satisfied: false },
		]);
		expect(dependencyView(rows[0]!, rows).usedBy).toEqual([
			{ plugin: "x/sales", version: "1.0.0", range: "^1.2.0", approval: "approved" },
		]);
	});
});
