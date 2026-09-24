import { describe, expect, it } from "bun:test";
import { declaredPackages, lockedVersion, resolveDependencies } from "../resolver";

// Talks to the real npm registry, so it lives in *.test.ts (CI only).
describe("resolveDependencies", () => {
	it("adds, pins by lockfile, and removes without installing", async () => {
		const added = await resolveDependencies(null, { add: [{ name: "ms", version: "2.1.2" }, { name: "lodash" }] }, 7);
		expect(declaredPackages(added.packageJson)).toMatchObject({ ms: "2.1.2" });
		expect(lockedVersion(added.lockfile, "ms")).toBe("2.1.2");
		expect(lockedVersion(added.lockfile, "lodash")).toMatch(/^4\./);

		const removed = await resolveDependencies(added, { remove: ["lodash"] }, 7);
		expect(Object.keys(declaredPackages(removed.packageJson))).toEqual(["ms"]);
		expect(lockedVersion(removed.lockfile, "lodash")).toBeNull();

		// bun deletes the lockfile once nothing is left
		const empty = await resolveDependencies(removed, { remove: ["ms"] }, 7);
		expect(declaredPackages(empty.packageJson)).toEqual({});
		expect(empty.lockfile).toBe("");
	}, 60_000);

	it("surfaces bun's error for a version the age rule blocks", async () => {
		// a 100-year minimum blocks every published version
		await expect(resolveDependencies(null, { add: [{ name: "ms" }] }, 36_500)).rejects.toThrow(
			/ms/,
		);
	}, 60_000);
});
