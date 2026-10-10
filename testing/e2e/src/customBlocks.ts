import { type RouteMiddlewares, registerCustomBlock, unregisterCustomBlock } from "@fluxify/blocks";
import { loadCustomBlock, type GraphFixture } from "./graph";

/**
 * Puts a fixture's custom blocks in the library before its route is compiled.
 * They are the project's own: `projectId` is the one the route runs under.
 *
 * This is the same two-step the real compiler does — compile the blocks, then
 * the routes — because a route that calls a custom block only emits if the
 * library already knows the name. Registration is worker-global, so the
 * returned dispose keeps one fixture's blocks out of another's run.
 *
 * Middleware blocks go in the same library: the worker looks them up by name
 * there too. `middlewares` is what the route artifact would carry.
 */
export async function registerFixtureBlocks(fixture: GraphFixture, projectId: string) {
	const registered: string[] = [];
	const register = async (file: string) => {
		const block = await loadCustomBlock(file);
		// the file name stands in for the block's id, which a fixture does not have
		registerCustomBlock(projectId, block.name, block.blocks, block.edges, file);
		registered.push(block.name);
		// one middleware per file, its chain that one block
		return { id: file, name: file, blocks: [block.name] };
	};
	for (const file of fixture.uses ?? []) await register(file);

	let middlewares: RouteMiddlewares | undefined;
	if (fixture.middlewares) {
		middlewares = { before: [], after: [] };
		for (const file of fixture.middlewares.before ?? []) middlewares.before.push(await register(file));
		for (const file of fixture.middlewares.after ?? []) middlewares.after.push(await register(file));
	}
	return {
		middlewares,
		dispose() {
			for (const name of registered) unregisterCustomBlock(projectId, name);
		},
	};
}
