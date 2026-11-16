import { describe, expect, it } from "bun:test";
import { BACKUP_MODULES } from "../modules";
import { orderModules } from "../registry";
import { notes, tags } from "./stubs";

describe("backup module registry", () => {
	it("puts every module after the ones it depends on", () => {
		expect(orderModules([notes, tags]).map((m) => m.name)).toEqual(["tags", "notes"]);
	});

	it("fails on a dependency cycle", () => {
		expect(() => orderModules([{ ...tags, dependsOn: ["notes"] }, notes])).toThrow(
			"cycle: tags → notes → tags",
		);
	});

	it("fails on a dependency nobody registered", () => {
		expect(() => orderModules([notes])).toThrow('depends on "tags", which is not registered');
	});

	it("fails on a name registered twice", () => {
		expect(() => orderModules([tags, tags])).toThrow('"tags" is registered twice');
	});

	it("fails when an upgrade step between minSupported and version is missing", () => {
		expect(() => orderModules([tags, { ...notes, upgrades: { 1: notes.upgrades[1]! } }])).toThrow(
			"no upgrade from v2",
		);
		expect(() => orderModules([{ ...tags, minSupported: 2 }])).toThrow("1 ≤ minSupported ≤ version");
	});

	it("the shipped list is valid", () => {
		expect(orderModules(BACKUP_MODULES)).toEqual(BACKUP_MODULES);
	});
});
