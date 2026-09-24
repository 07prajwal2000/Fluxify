import { describe, expect, it } from "bun:test";
import { assertPackageName, declaredPackages, lockedVersion, resolveDependencies } from "../resolver";

describe("package names", () => {
	it("accepts npm names, scoped or not", () => {
		for (const name of ["lodash", "@scope/pkg", "a.b-c_d"]) expect(() => assertPackageName(name)).not.toThrow();
	});

	it("refuses anything bun could read as a flag or a path", () => {
		for (const name of ["--registry=http://evil", "-g", "../x", "Lodash", "a b", ""]) {
			expect(() => assertPackageName(name)).toThrow("not a valid npm package name");
		}
	});

	it("refuses a version that is a flag", async () => {
		await expect(
			resolveDependencies(null, { add: [{ name: "ms", version: "--trust" }] }, 0),
		).rejects.toThrow("not a valid version");
	});
});

describe("manifest reading", () => {
	const lockfile = `{
  "lockfileVersion": 1,
  "packages": {
    "@img/sharp": ["@img/sharp@0.34.5", "", {}, "sha512-x"],
    "ms": ["ms@2.1.3", "", {}, "sha512-y"],
  }
}`;

	it("reads the pinned version of a top-level package", () => {
		expect(lockedVersion(lockfile, "ms")).toBe("2.1.3");
		expect(lockedVersion(lockfile, "@img/sharp")).toBe("0.34.5");
		expect(lockedVersion(lockfile, "lodash")).toBeNull();
	});

	it("reads declared dependencies, none when absent", () => {
		expect(declaredPackages('{"dependencies":{"ms":"^2"}}')).toEqual({ ms: "^2" });
		expect(declaredPackages("{}")).toEqual({});
	});
});
