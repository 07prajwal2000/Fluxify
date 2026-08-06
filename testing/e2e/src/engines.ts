import type { Connection } from "@fluxify/adapters";
import { database, stopDatabase } from "./postgres";
import { mongo, stopMongo } from "./mongo";
import { seedPostgres, seedMongo } from "./seed";

/**
 * Which database a graph fixture runs against.
 *
 * Fixtures are written per engine rather than run across all of them: the
 * adapters do not agree on what a result looks like (Mongo ids are hex strings,
 * joins have no Mongo equivalent), so a shared assertion would have to be
 * weakened until it stopped proving much. Each engine gets graphs that exercise
 * what is actually distinctive about it.
 */
export type Engine = "pg" | "mongo";

export async function connectionFor(engine: Engine): Promise<Connection> {
	if (engine === "mongo") return (await mongo()).connection;
	return (await database()).connection;
}

/** Drops and re-seeds the engine's fixtures. Call from `beforeEach`. */
export async function resetDatabase(engine: Engine) {
	if (engine === "mongo") return seedMongo((await mongo()).db);
	return seedPostgres((await database()).sql);
}

/** Stops whichever containers actually started. */
export async function stopEngines() {
	await Promise.all([stopDatabase(), stopMongo()]);
}
