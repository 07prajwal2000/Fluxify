// #1106: the pure parts of backups to object storage: when a project is due,
// what a prefix may be, how keys are named, and what retention may delete.
import { describe, expect, it } from "bun:test";
import { entitlement, type License } from "@fluxify/common/license";
import type { ObjectStorageAdapter } from "@fluxify/sdk/integrations";
import { assertCanRunStorageBackups, canRunStorageBackups } from "../../../lib/edition";
import { BACKUP_NAME, backupBase, backupPrefixSchema, defaultPrefix, isDue } from "../prefix";
import { pruneBackups } from "../storageDestination";

const day = 24 * 60 * 60_000;
const at = (iso: string) => new Date(iso);

describe("isDue", () => {
	const now = at("2026-11-16T00:00:03Z");
	it("is due with no successful backup yet", () => {
		expect(isDue(null, "daily", now)).toBe(true);
	});
	it("runs a daily one on the next tick even if that fires a few seconds early", () => {
		expect(isDue(at("2026-11-15T00:00:05Z"), "daily", now)).toBe(true);
	});
	it("does nothing on a second tick the same day", () => {
		expect(isDue(at("2026-11-16T00:00:01Z"), "daily", at("2026-11-16T12:00:00Z"))).toBe(false);
	});
	it("waits a week, and a calendar month", () => {
		expect(isDue(at("2026-11-10T00:00:00Z"), "weekly", now)).toBe(false);
		expect(isDue(at("2026-11-09T00:00:00Z"), "weekly", now)).toBe(true);
		expect(isDue(at("2026-10-20T00:00:00Z"), "monthly", now)).toBe(false);
		expect(isDue(at("2026-10-16T00:00:00Z"), "monthly", now)).toBe(true);
	});
	it("catches up after downtime", () => {
		expect(isDue(new Date(now.getTime() - 40 * day), "weekly", now)).toBe(true);
	});
});

describe("prefix", () => {
	it.each(["acme", "acme/prod", "a.b_c-d/2026"])("accepts %s", (p) => {
		expect(backupPrefixSchema.safeParse(p).success).toBe(true);
	});
	it.each(["", "/acme", "acme/", "a//b", "../x", "a/../b", "a b", ".hidden"])("refuses %p", (p) => {
		expect(backupPrefixSchema.safeParse(p).success).toBe(false);
	});
	it("defaults to the slug", () => {
		expect(defaultPrefix("my-shop")).toBe("my-shop");
		expect(backupPrefixSchema.safeParse(defaultPrefix("_odd slug")).success).toBe(true);
	});
	it("names keys by sortable time, with no ':'", () => {
		const base = backupBase("acme", at("2026-11-16T09:05:03.123Z"), "b123");
		expect(base).toBe("acme/20261116T090503Z-b123");
		expect(BACKUP_NAME.exec(`${base.slice(5)}.tar.gz`)?.[1]).toBe("20261116T090503Z-b123");
		expect(BACKUP_NAME.test("nested/20261116T090503Z-b.tar.gz")).toBe(false);
	});
});

/** an in-memory bucket, listed in key order like S3, two keys a page */
function bucket(keys: string[]) {
	const held = new Set(keys);
	const storage = {
		async list(prefix: string, opts: { cursor?: string } = {}) {
			const all = [...held].filter((k) => k.startsWith(prefix)).sort();
			const from = Number(opts.cursor ?? 0);
			const objects = all.slice(from, from + 2).map((key) => ({ key, size: 1, lastModified: new Date() }));
			return { objects, cursor: from + 2 < all.length ? String(from + 2) : undefined };
		},
		async delete(key: string) {
			held.delete(key);
		},
	} as unknown as ObjectStorageAdapter;
	return { storage, held };
}

const pair = (prefix: string, day: number) => [
	`${prefix}/202611${String(day).padStart(2, "0")}T000000Z-b${day}.tar.gz`,
	`${prefix}/202611${String(day).padStart(2, "0")}T000000Z-b${day}.meta.json`,
];

describe("pruneBackups", () => {
	it("deletes the oldest pairs beyond N, archive and summary together", async () => {
		const { storage, held } = bucket([1, 2, 3, 4].flatMap((d) => pair("acme", d)));
		const deleted = await pruneBackups(storage, "acme", 2);
		expect(deleted.sort()).toEqual([...pair("acme", 1), ...pair("acme", 2)].sort());
		expect([...held].sort()).toEqual([...pair("acme", 3), ...pair("acme", 4)].sort());
	});

	it("counts only complete backups, and never touches what it didn't write", async () => {
		const stray = ["acme/notes.txt", "acme/old/20261101T000000Z-x.tar.gz", "acme-2/20261101T000000Z-y.tar.gz"];
		// day 4's archive has no summary: incomplete, so day 2 is still among the newest two complete
		const { storage, held } = bucket([...pair("acme", 1), ...pair("acme", 2), ...pair("acme", 3), pair("acme", 4)[0]!, ...stray]);
		await pruneBackups(storage, "acme", 2);
		expect([...held].sort()).toEqual(
			[...pair("acme", 2), ...pair("acme", 3), pair("acme", 4)[0]!, ...stray].sort(),
		);
	});

	it("keeps prefixes a and ab apart", async () => {
		const { storage, held } = bucket([1, 2, 3].flatMap((d) => [...pair("a", d), ...pair("ab", d)]));
		await pruneBackups(storage, "a", 1);
		expect([...held].filter((k) => k.startsWith("ab/")).length).toBe(6);
		expect([...held].filter((k) => k.startsWith("a/")).sort()).toEqual(pair("a", 3).sort());
	});

	it("deletes nothing at or under N", async () => {
		const { storage } = bucket([1, 2].flatMap((d) => pair("acme", d)));
		expect(await pruneBackups(storage, "acme", 2)).toEqual([]);
	});
});

describe("edition gate", () => {
	const signed = (features: string[], expiresInDays: number): License => ({
		kind: "signed",
		licensee: "acme",
		expiresAt: new Date(Date.now() + expiresInDays * day).toISOString(),
		features,
	});
	it.each([
		["community", { kind: "community" } as License, false],
		["non-commercial", { kind: "non_commercial" } as License, true],
		["enterprise with the feature", signed(["objectStorageBackups"], 30), true],
		["enterprise without it", signed(["sso"], 30), false],
		["expired, in grace", signed(["objectStorageBackups"], -5), true],
		["expired, past grace", signed(["objectStorageBackups"], -400), false],
	])("%s", (_name, license, expected) => {
		const e = entitlement(license);
		expect(canRunStorageBackups(e)).toBe(expected);
		if (expected) expect(() => assertCanRunStorageBackups(e)).not.toThrow();
		else expect(() => assertCanRunStorageBackups(e)).toThrow(/license/);
	});
	it("tells community what it needs", () => {
		expect(() => assertCanRunStorageBackups(entitlement({ kind: "community" }))).toThrow(
			"Backups to object storage need an enterprise or non-commercial license",
		);
	});
});
