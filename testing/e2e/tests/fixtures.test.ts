import { describe, expect, it } from "bun:test";
import { compileGraph } from "@fluxify/blocks";
import { registerFixtureBlocks } from "../src/customBlocks";
import {
	customBlockFiles,
	graphNames,
	loadCustomBlock,
	loadGraph,
	loadWorkflow,
	workflowNames,
} from "../src/graph";

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
			// a caller only emits once its custom blocks are in the library
			const dispose = await registerFixtureBlocks(fixture);
			try {
				expect(compileGraph(fixture.blocks, fixture.edges).source).toBeString();
			} finally {
				dispose();
			}
		});
	}
});

describe("workflow fixtures", () => {
	for (const name of workflowNames()) {
		it(`${name} compiles as a workflow`, async () => {
			const fixture = await loadWorkflow(name);
			const { source } = compileGraph(fixture.blocks, fixture.edges, {
				asWorkflow: true,
			});
			// a workflow has nobody to reply to, so a response block on the canvas
			// must have compiled to a plain terminal rather than an HTTP result
			expect(source).not.toContain("httpCode");
		});
	}
});

describe("custom block fixtures", () => {
	for (const file of customBlockFiles()) {
		it(`${file} compiles as a custom block`, async () => {
			const block = await loadCustomBlock(file);
			const { source } = compileGraph(block.blocks, block.edges, {
				asCustomBlock: true,
			});
			expect(source).toBeString();
		});
	}
});
