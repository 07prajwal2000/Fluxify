import { describe, expect, it } from "bun:test";
import { compileGraph } from "@fluxify/blocks";
import { graphNames, loadGraph } from "../src/graph";

/**
 * Guards the fixtures themselves. A graph that no longer compiles is a broken
 * test, not a caught regression, and without this it surfaces as a confusing
 * failure in whichever suite happens to load it.
 */
describe("graph fixtures", () => {
	it("has at least one graph", () => {
		expect(graphNames().length).toBeGreaterThan(0);
	});

	for (const name of graphNames()) {
		it(`${name} compiles`, async () => {
			const fixture = await loadGraph(name);
			expect(fixture.route.path.startsWith("/")).toBe(true);
			expect(compileGraph(fixture.blocks, fixture.edges).source).toBeString();
		});
	}
});
