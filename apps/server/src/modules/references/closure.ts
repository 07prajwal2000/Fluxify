import type { HookSuite, ProdEntry, ProdGraph } from "./prodGraph";

/**
 * Who uses a custom block or middleware in production, and what a version needs
 * live (#740). Both walk "uses of uses" through promoted versions, and both
 * keep a visited set: a block that calls another that calls it back (possible
 * across two promoted versions) ends the walk instead of looping.
 */

/** a custom block or a middleware, by the id and name the portal shows */
export type Dependency = { kind: "custom_block" | "middleware"; id: string; name: string };

/** what one version names: the seed of a walk */
export type Uses = {
	blockTypes: Iterable<string>;
	middlewares: Iterable<string>;
	/** custom block ids: a middleware's chain, or a suite's hooks */
	blockIds: Iterable<string>;
};

export const usesOf = (entry: ProdEntry): Uses => ({
	blockTypes: entry.blockTypes,
	middlewares: entry.middlewares,
	blockIds: entry.chain,
});

/**
 * What a version needs that has no production version, however deep: a custom
 * block it calls, a middleware it attaches, or a block those use. Anything
 * with a promoted version is followed through that version, never through its
 * working copy. A name that is no custom block is left to the compile check.
 */
export function missingDependencies(graph: ProdGraph, uses: Uses, self?: string): Dependency[] {
	const missing = new Map<string, Dependency>();
	const seen = new Set<string>(self ? [`custom_block:${self}`, `middleware:${self}`] : []);

	const walk = (next: Uses) => {
		for (const type of next.blockTypes) visit("custom_block", graph.blocksByName.get(type));
		for (const id of next.blockIds) visit("custom_block", graph.blocksById.get(id));
		for (const id of next.middlewares) visit("middleware", graph.middlewares.get(id));
	};
	const visit = (
		kind: Dependency["kind"],
		row: { id: string; name: string; prodVersionId: string | null } | undefined,
	) => {
		if (!row || seen.has(`${kind}:${row.id}`)) return;
		seen.add(`${kind}:${row.id}`);
		if (!row.prodVersionId) {
			missing.set(`${kind}:${row.id}`, { kind, id: row.id, name: row.name });
			return;
		}
		const entry = graph.entries.get(`${kind}:${row.id}`);
		if (entry) walk(usesOf(entry));
	};

	walk(uses);
	return [...missing.values()];
}

export type ProdUsers = {
	/** the routes and workflows whose promoted version reaches the subject */
	targets: ProdEntry[];
	/** every custom block on the way, the subject included: a suite hook among them counts */
	blockIds: Set<string>;
	/** suites that use one of those blocks as a hook, whose target has a promoted version */
	hookSuites: HookSuite[];
};

/**
 * Every route and workflow in production that runs the subject: directly, or
 * through custom blocks and middlewares that do. Suites that use the subject (or
 * a block that reaches it) as a hook are listed too, since a hook runs in the
 * suite's production runs.
 */
export function prodUsers(
	graph: ProdGraph,
	subject: Dependency & { kind: "custom_block" | "middleware" },
): ProdUsers {
	const targets = new Map<string, ProdEntry>();
	const blockIds = new Set<string>();
	const seen = new Set<string>();

	const queue: Dependency[] = [subject];
	while (queue.length) {
		const next = queue.shift()!;
		const key = `${next.kind}:${next.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		if (next.kind === "custom_block") blockIds.add(next.id);

		for (const entry of graph.entries.values()) {
			const reaches =
				next.kind === "custom_block"
					? entry.blockTypes.has(next.name) ||
						(entry.kind === "middleware" && entry.chain.includes(next.id))
					: entry.kind === "route" && entry.middlewares.includes(next.id);
			if (!reaches || (entry.kind === next.kind && entry.id === next.id)) continue;
			if (entry.kind === "route" || entry.kind === "workflow")
				targets.set(entryKeyOf(entry), entry);
			else queue.push({ kind: entry.kind, id: entry.id, name: entry.name });
		}
	}

	const hookSuites = graph.hookSuites.filter(
		(suite) => suite.target.prodVersionId !== null && suite.blockIds.some((id) => blockIds.has(id)),
	);
	return { targets: [...targets.values()], blockIds, hookSuites };
}

const entryKeyOf = (entry: ProdEntry) => `${entry.kind}:${entry.id}`;
