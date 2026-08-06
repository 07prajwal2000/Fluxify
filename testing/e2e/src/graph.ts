import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { BlockDTOType, EdgeDTOSchemaType } from "@fluxify/blocks";
import type { Engine } from "./engines";

/**
 * A graph fixture as it sits on disk. `blocks`/`edges` are the same shape the
 * canvas saves and the compiler consumes, so a fixture can be pasted straight
 * out of a real project — nothing here is a test-only dialect.
 */
export type GraphFixture = {
	name: string;
	description: string;
	/** which database the fixture's db blocks run against; defaults to Postgres */
	engine?: Engine;
	route: { method: string; path: string };
	/**
	 * Route-level request validation, in the same JSON the portal stores. This
	 * runs before the graph does, so a fixture asserts on 400s without a single
	 * validation block on the canvas.
	 */
	schemas?: { body?: unknown; query?: unknown; params?: unknown };
	blocks: BlockDTOType[];
	edges: EdgeDTOSchemaType;
};

const graphsDir = join(import.meta.dir, "..", "graphs");

export async function loadGraph(name: string): Promise<GraphFixture> {
	const fixture = (await Bun.file(
		join(graphsDir, `${name}.json`),
	).json()) as GraphFixture;
	if (fixture.name !== name) {
		// the file name is the test's handle on the fixture; a mismatch means a
		// copy-paste that would silently assert against the wrong graph
		throw new Error(`graph ${name}.json declares name "${fixture.name}"`);
	}
	return fixture;
}

/**
 * Every fixture on disk, so a suite can assert across all of them. Recursive:
 * a feature with several endpoints gets its own subfolder, and its fixtures are
 * named by path (`auth/login`).
 */
export function graphNames(): string[] {
	return readdirSync(graphsDir, { recursive: true })
		.map((file) => String(file).replaceAll("\\", "/"))
		.filter((file) => file.endsWith(".json"))
		.map((file) => file.slice(0, -".json".length));
}
