import { describe, expect, it } from "bun:test";
import type { IdMap } from "../../types";
import { blankCredentials } from "../integrations";
import {
	localIntegrations,
	lostWarnings,
	remapIntegrations,
	tableFor,
	v1Table,
} from "../integrationRefs";

const PG = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const BUS = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const ids = (known: Record<string, string>): IdMap => ({
	set: () => {},
	get: (_, name) => known[name],
});

describe("integration references", () => {
	const route = {
		blocks: [{ key: "db_1", data: { connection: PG, nested: [{ any: PG }], text: "pg-main" } }],
		config: { sseBrokerId: BUS },
	};

	it("finds an id wherever it sits, by value, and names it", () => {
		const names = new Map([
			[PG, "pg-main"],
			[BUS, "bus"],
			["unused", "x"],
		]);
		expect(tableFor(route, names)).toEqual({ [PG]: "pg-main", [BUS]: "bus" });
	});

	it("resolves names to this project's ids, blanks the rest, and never rewrites a name in place", () => {
		const lookup = localIntegrations({ [PG]: "pg-main", [BUS]: "bus" }, ids({ "pg-main": "new-pg" }));
		expect(remapIntegrations(route, lookup)).toEqual({
			blocks: [{ key: "db_1", data: { connection: "new-pg", nested: [{ any: "new-pg" }], text: "pg-main" } }],
			config: { sseBrokerId: "" },
		});
		// a key on Object.prototype is not an entry
		expect(lookup("constructor")).toBeUndefined();
	});

	it("warns once per resource, naming each place and integration", () => {
		const places = [
			{ where: "block db_1", value: route.blocks[0]!.data },
			{ where: "SSE broker", value: BUS },
		];
		const table = { [PG]: "pg-main", [BUS]: "" };
		expect(lostWarnings('Route "r"', places, table, new Set(["pg-main"]), "Fix it.")).toEqual([
			`Route "r" uses integrations this backup doesn't restore: SSE broker (an integration from an older backup). Fix it.`,
		]);
		// an integration with no name never stands in for one whose name is unknown
		expect(lostWarnings('Route "r"', places, table, new Set(["pg-main", ""]), "Fix it.")).toHaveLength(1);
		expect(lostWarnings('Route "r"', [places[0]!], table, new Set(["pg-main"]), "Fix it.")).toEqual([]);
		expect(localIntegrations(table, ids({ "": "unnamed" }))(BUS)).toBe("");
	});

	it("a v1 section's table holds the uuids under integration keys, with no names", () => {
		const v1 = {
			routes: [{ ...route, suites: [{ integrationOverrides: [{ existing: PG, replacement: BUS }] }] }],
			// a replace block's `replacement` is text, not an id
			other: { replacement: "pg-main", connection: "param:db" },
		};
		expect(v1Table(v1)).toEqual({ [PG]: "", [BUS]: "" });
		const triggers = { triggers: [{ integrationId: null, source: { store: PG, topic: "t" } }] };
		expect(v1Table(triggers)).toEqual({});
		expect(v1Table(triggers, { sourceParams: true })).toEqual({ [PG]: "" });
	});
});

describe("template credentials", () => {
	it("blank literal text, keep app config references, numbers and booleans, drop an MCP sign-in", () => {
		const config = { host: "db", port: 5432, ssl: true, password: "cfg:PG", headers: [{ v: "x" }], oauth: { v: 1 } };
		expect(blankCredentials(config)).toEqual({ host: "", port: 5432, ssl: true, password: "cfg:PG", headers: [{ v: "" }] });
	});
});
