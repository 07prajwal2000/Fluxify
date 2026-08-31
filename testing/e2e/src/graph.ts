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
	/**
	 * Custom blocks this graph calls, by file name in `blocks/`. They are
	 * compiled and registered into the block library before the route is
	 * compiled — the same order the real compiler works in, and the reason a
	 * route calling one resolves at all.
	 */
	uses?: string[];
	blocks: BlockDTOType[];
	edges: EdgeDTOSchemaType;
};

/**
 * A workflow fixture: the same canvas JSON, minus everything HTTP.
 *
 * A workflow has no route to be reached on, no request to validate and no
 * status code to return — it is started by a queued job, and that job's payload
 * is what the graph sees as `input`. A response block on the canvas still ends
 * the run; it just stops meaning "reply with this".
 */
export type WorkflowFixture = {
	/** Also the workflow id the harness publishes and queues it under. */
	name: string;
	description: string;
	/** The run's budget. Defaults to 30s, which no fixture should come near. */
	timeoutSeconds?: number;
	blocks: BlockDTOType[];
	edges: EdgeDTOSchemaType;
};

/**
 * A custom block as the portal saves it: a graph plus the input contract its
 * callers configure. `name` is what a calling block carries as its type.
 */
export type CustomBlockFixture = {
	name: string;
	description: string;
	inputParams?: unknown[];
	blocks: BlockDTOType[];
	edges: EdgeDTOSchemaType;
};

const graphsDir = join(import.meta.dir, "..", "graphs");
const blocksDir = join(import.meta.dir, "..", "blocks");
/**
 * Workflows sit beside the route graphs rather than in a subfolder of them:
 * they compile under a different option and are loaded by a different harness,
 * so a suite that walks `graphs/` must not pick one up and expect a route.
 */
const workflowsDir = join(import.meta.dir, "..", "workflows");

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
	return jsonNames(graphsDir);
}

/** Loads one workflow by file name — `workflows/notify.json` is `notify`. */
export async function loadWorkflow(name: string): Promise<WorkflowFixture> {
	const fixture = (await Bun.file(
		join(workflowsDir, `${name}.json`),
	).json()) as WorkflowFixture;
	if (fixture.name !== name) {
		throw new Error(`workflow ${name}.json declares name "${fixture.name}"`);
	}
	return fixture;
}

export function workflowNames(): string[] {
	return jsonNames(workflowsDir);
}

/** Loads one custom block by file name — `blocks/jwt-ops.json` is `jwt-ops`. */
export async function loadCustomBlock(file: string): Promise<CustomBlockFixture> {
	return (await Bun.file(
		join(blocksDir, `${file}.json`),
	).json()) as CustomBlockFixture;
}

export function customBlockFiles(): string[] {
	return jsonNames(blocksDir);
}

function jsonNames(dir: string): string[] {
	return readdirSync(dir, { recursive: true })
		.map((file) => String(file).replaceAll("\\", "/"))
		.filter((file) => file.endsWith(".json"))
		.map((file) => file.slice(0, -".json".length));
}
