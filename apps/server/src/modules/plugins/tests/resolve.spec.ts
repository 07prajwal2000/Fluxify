import { describe, expect, it } from "bun:test";
import type { PluginDependency } from "@fluxify/sdk/blocks";
import { DependencyError, type Installed, type Registry, resolveDependencies } from "../resolve";

/** `x/a` is npm `@x/a` */
const dep = (plugin: string, range: string): PluginDependency => ({
	name: `@${plugin}`,
	plugin,
	range,
});

/** a registry of plugin -> version -> its dependencies; counts what is fetched */
function registry(published: Record<string, Record<string, PluginDependency[]>>) {
	const fetched: string[] = [];
	const r: Registry = {
		versions: async (name) => Object.keys(published[name.slice(1)] ?? {}),
		manifest: async (name, version) => {
			fetched.push(`${name}@${version}`);
			return { name: name.slice(1), dependencies: published[name.slice(1)]![version] };
		},
	};
	return { r, fetched };
}

const root = (...dependencies: PluginDependency[]) => ({ plugin: "x/root", dependencies });

const refusal = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (error) {
		if (error instanceof DependencyError) return { kind: error.kind, message: error.message };
		throw error;
	}
	throw new Error("expected a DependencyError");
};

describe("resolveDependencies", () => {
	it("installs the newest version in range, a dependency before what needs it", async () => {
		const { r } = registry({
			"x/a": { "1.0.0": [dep("x/b", "^2.0.0")], "1.3.0": [dep("x/b", "^2.0.0")], "2.0.0": [] },
			"x/b": { "2.0.0": [], "2.4.1": [], "3.0.0": [] },
		});
		expect(await resolveDependencies(root(dep("x/a", "^1.0.0")), [], r)).toEqual([
			{ name: "@x/b", plugin: "x/b", version: "2.4.1" },
			{ name: "@x/a", plugin: "x/a", version: "1.3.0" },
		]);
	});

	it("installs a diamond's shared dependency once, at a version both accept", async () => {
		const { r, fetched } = registry({
			"x/a": { "1.0.0": [dep("x/c", "^1.1.0")] },
			"x/b": { "1.0.0": [dep("x/c", ">=1.0.0 <1.5.0")] },
			"x/c": { "1.0.0": [], "1.2.0": [] },
		});
		const steps = await resolveDependencies(root(dep("x/a", "1.0.0"), dep("x/b", "1.0.0")), [], r);
		expect(steps.map((s) => `${s.plugin}@${s.version}`)).toEqual(["x/c@1.2.0", "x/a@1.0.0", "x/b@1.0.0"]);
		expect(fetched.filter((f) => f.startsWith("@x/c"))).toEqual(["@x/c@1.2.0"]);
	});

	it("refuses a diamond whose two ranges cannot share one version", async () => {
		const { r } = registry({
			"x/a": { "1.0.0": [dep("x/c", "^1.0.0")] },
			"x/b": { "1.0.0": [dep("x/c", "^2.0.0")] },
			"x/c": { "1.0.0": [], "2.0.0": [] },
		});
		expect(await refusal(resolveDependencies(root(dep("x/a", "1.0.0"), dep("x/b", "1.0.0")), [], r))).toEqual({
			kind: "conflict",
			message: "x/b needs x/c ^2.0.0, but x/a needs x/c ^1.0.0 (version 1.0.0)",
		});
	});

	it("refuses a cycle with its path, through the registry or through what is installed", async () => {
		const { r } = registry({
			"x/a": { "1.0.0": [dep("x/b", "^1.0.0")] },
			"x/b": { "1.0.0": [dep("x/a", "^1.0.0")] },
		});
		expect(await refusal(resolveDependencies(root(dep("x/a", "^1.0.0")), [], r))).toEqual({
			kind: "cycle",
			message: "Plugin dependencies form a cycle: x/a -> x/b -> x/a",
		});
		const installed: Installed[] = [{ plugin: "x/a", version: "1.0.0", dependencies: [dep("x/root", "*")] }];
		expect((await refusal(resolveDependencies(root(dep("x/a", "^1.0.0")), installed, r))).message).toBe(
			"Plugin dependencies form a cycle: x/root -> x/a -> x/root",
		);
	});

	it("keeps an installed dependency in range, fetching nothing for it", async () => {
		const { r, fetched } = registry({ "x/a": { "1.0.0": [], "1.9.0": [] } });
		const installed: Installed[] = [{ plugin: "x/a", version: "1.0.0", dependencies: [] }];
		expect(await resolveDependencies(root(dep("x/a", "^1.0.0")), installed, r)).toEqual([]);
		expect(fetched).toEqual([]);
	});

	it("upgrades an installed dependency when every other plugin needing it accepts the new version", async () => {
		const { r } = registry({ "x/a": { "1.0.0": [], "1.6.0": [], "2.0.0": [] } });
		const installed: Installed[] = [
			{ plugin: "x/a", version: "1.0.0", dependencies: [] },
			{ plugin: "x/other", version: "3.0.0", dependencies: [dep("x/a", "^1.0.0")] },
			// the old version of the plugin being installed does not count
			{ plugin: "x/root", version: "0.1.0", dependencies: [dep("x/a", "1.0.0")] },
		];
		expect(await resolveDependencies(root(dep("x/a", "^1.5.0")), installed, r)).toEqual([
			{ name: "@x/a", plugin: "x/a", version: "1.6.0", from: "1.0.0" },
		]);
	});

	it("refuses an upgrade another installed plugin's range does not accept, naming who needs what", async () => {
		const { r } = registry({ "x/a": { "1.0.0": [], "2.1.0": [] } });
		const installed: Installed[] = [
			{ plugin: "x/a", version: "1.0.0", dependencies: [] },
			{ plugin: "x/other", version: "3.0.0", dependencies: [dep("x/a", "^1.0.0")] },
		];
		expect(await refusal(resolveDependencies(root(dep("x/a", "^2.0.0")), installed, r))).toEqual({
			kind: "conflict",
			message:
				"x/root needs x/a ^2.0.0, so it would be upgraded from 1.0.0 to 2.1.0, but x/other needs ^1.0.0",
		});
	});

	it("refuses a package missing from the registry, or with no version in range", async () => {
		const { r } = registry({ "x/a": { "1.0.0": [] } });
		expect(await refusal(resolveDependencies(root(dep("x/gone", "^1.0.0")), [], r))).toEqual({
			kind: "missing",
			message: "x/root needs @x/gone ^1.0.0, and no version of it on the registry matches",
		});
		expect((await refusal(resolveDependencies(root(dep("x/a", "^2.0.0")), [], r))).kind).toBe("missing");
	});

	it("refuses a package that turns out to be another plugin", async () => {
		const r: Registry = {
			versions: async () => ["1.0.0"],
			manifest: async () => ({ name: "y/impostor" }),
		};
		expect((await refusal(resolveDependencies(root(dep("x/a", "^1.0.0")), [], r))).message).toBe(
			"@x/a@1.0.0 is plugin y/impostor, but x/root expects x/a",
		);
	});
});
