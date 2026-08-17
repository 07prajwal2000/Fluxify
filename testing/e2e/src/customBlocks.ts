import { registerCustomBlock, unregisterCustomBlock } from "@fluxify/blocks";
import { loadCustomBlock, type GraphFixture } from "./graph";

/**
 * Puts a fixture's custom blocks in the library before its route is compiled.
 *
 * This is the same two-step the real compiler does — compile the blocks, then
 * the routes — because a route that calls a custom block only emits if the
 * library already knows the name. Registration is worker-global, so the
 * returned dispose keeps one fixture's blocks out of another's run.
 */
export async function registerFixtureBlocks(fixture: GraphFixture) {
	const registered: string[] = [];
	for (const file of fixture.uses ?? []) {
		const block = await loadCustomBlock(file);
		registerCustomBlock(block.name, block.blocks, block.edges);
		registered.push(block.name);
	}
	return () => {
		for (const name of registered) unregisterCustomBlock(name);
	};
}
