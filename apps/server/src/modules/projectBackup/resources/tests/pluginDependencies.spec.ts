import { describe, expect, it } from "bun:test";
import { missingDependencyWarnings } from "../pluginDependencies";

const plugin = (name: string, version: string, deps: Record<string, string> = {}) => ({
	name,
	version,
	manifest: { dependencies: Object.entries(deps).map(([p, range]) => ({ name: `@${p}`, plugin: p, range })) },
});

describe("warnings for a backup's missing plugin dependencies", () => {
	it("says nothing when every dependency is in the backup, in range", () => {
		expect(missingDependencyWarnings([plugin("x/lib", "1.2.0"), plugin("x/app", "1.0.0", { "x/lib": "^1.0.0" })])).toEqual([]);
		expect(missingDependencyWarnings([plugin("x/solo", "1.0.0")])).toEqual([]);
	});

	it("names each plugin whose dependency the backup lacks or holds out of range", () => {
		const warnings = missingDependencyWarnings([
			plugin("x/lib", "2.0.0"),
			plugin("x/app", "1.0.0", { "x/lib": "^1.0.0", "x/gone": "*" }),
		]);
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toStartWith('Plugin "x/app" needs plugin x/lib ^1.0.0, but this backup holds version 2.0.0.');
		expect(warnings[1]).toStartWith('Plugin "x/app" needs plugin x/gone *, which this backup does not hold.');
		expect(warnings[1]).toContain("stays blocked");
	});
});
