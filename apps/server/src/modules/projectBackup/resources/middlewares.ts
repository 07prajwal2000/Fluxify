import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db";
import {
	customBlocksListEntity,
	type MiddlewareSnapshot,
	middlewaresEntity,
	type VersionSnapshot,
} from "../../../db/schema";
import { BadRequestError } from "../../../errors/badRequestError";
import { backupHistorySchema, exportHistory, importHistory } from "../../versions/backup";
import { buildSnapshot, restoreSnapshot } from "../../versions/snapshot";
import type { BackupModule, IdMap } from "../types";

/**
 * Every middleware of a project (#1099). A middleware's version is its chain of
 * custom block ids; in the backup the chain holds their names, and restore
 * resolves them through the `customBlocks` section.
 */

const middlewareSchema = z.object({
	name: z.string().min(1),
	description: z.string().nullable().default(null),
	history: backupHistorySchema,
});

const schema = z.object({ middlewares: z.array(middlewareSchema) });
type Section = z.infer<typeof schema>;

const withChain = (snapshot: VersionSnapshot, chain: string[]): VersionSnapshot => ({
	...(snapshot as MiddlewareSnapshot),
	settings: { chain },
});
const chainOf = (snapshot: VersionSnapshot) => (snapshot as MiddlewareSnapshot).settings.chain;

/** names → this project's ids. A chain that loses a link would run differently, so refuse. */
const localChain = (ids: IdMap, middleware: string) => (snapshot: VersionSnapshot) =>
	withChain(
		snapshot,
		chainOf(snapshot).map((name) => {
			const id = ids.get("customBlocks", name);
			if (!id)
				throw new BadRequestError(
					`Middleware "${middleware}" runs the custom block "${name}", which isn't in this backup.`,
				);
			return id;
		}),
	);

export const middlewaresModule: BackupModule<Section> = {
	name: "middlewares",
	version: 1,
	minSupported: 1,
	upgrades: {},
	dependsOn: ["customBlocks"],
	schema,

	async export({ projectId, options }) {
		const middlewares = await db.transaction(async (tx) => {
			const blocks = await tx
				.select({ id: customBlocksListEntity.id, name: customBlocksListEntity.name })
				.from(customBlocksListEntity)
				.where(eq(customBlocksListEntity.projectId, projectId));
			const nameOf = new Map(blocks.map((b) => [b.id, b.name]));
			// a block deleted since a version was committed has no name to travel by
			const portable = (snapshot: VersionSnapshot) =>
				withChain(
					snapshot,
					chainOf(snapshot).flatMap((id) => (nameOf.has(id) ? [nameOf.get(id)!] : [])),
				);

			const rows = await tx
				.select()
				.from(middlewaresEntity)
				.where(eq(middlewaresEntity.projectId, projectId))
				.orderBy(asc(middlewaresEntity.createdAt));
			const out: Section["middlewares"] = [];
			for (const row of rows) {
				const working = await buildSnapshot("middleware", row.id, tx);
				out.push({
					name: row.name,
					description: row.description,
					history: await exportHistory(
						"middleware",
						row.id,
						working,
						options.includeVersionHistory,
						portable,
						tx,
					),
				});
			}
			return out;
		});
		return { data: { middlewares } };
	},

	async import({ tx, projectId, ids }, { middlewares }) {
		for (const { name, description, history } of middlewares) {
			const local = localChain(ids, name);
			const [row] = await tx
				.insert(middlewaresEntity)
				.values({ name, description, projectId })
				.returning({ id: middlewaresEntity.id });
			const target = { id: row!.id, projectId };
			await restoreSnapshot("middleware", target, local(history.working as VersionSnapshot), tx);
			await importHistory("middleware", target, history, local, tx);
			ids.set("middlewares", name, target.id);
		}
	},
};
