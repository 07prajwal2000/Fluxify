import { describe, expect, test } from "bun:test";
import { plan } from "./build-docs";

describe("versioned docs plan", () => {
	test("with no versioned release, main is the whole site and there is no dropdown", () => {
		expect(plan([])).toEqual({ builds: [{ label: "Nightly", base: "/" }], versions: [] });
	});

	test("newest release at /, main at /nightly/, older releases under their tag", () => {
		const { builds, versions } = plan(["v0.6.0", "v0.5.0"]);
		expect(builds).toEqual([
			{ tag: "v0.6.0", label: "v0.6.0", base: "/" },
			{ label: "Nightly", base: "/nightly/" },
			{ tag: "v0.5.0", label: "v0.5.0", base: "/v0.5.0/" },
		]);
		expect(versions.map((v) => [v.text, v.link])).toEqual([
			["v0.6.0 (latest)", "https://docs.fluxify.rest/"],
			["Nightly", "https://docs.fluxify.rest/nightly/"],
			["v0.5.0", "https://docs.fluxify.rest/v0.5.0/"],
		]);
	});

	test("keeps only the newest 10 releases", () => {
		const tags = Array.from({ length: 15 }, (_, i) => `v0.${15 - i}.0`);
		expect(plan(tags).builds.filter((b) => b.tag)).toHaveLength(10);
	});
});
