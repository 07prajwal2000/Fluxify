import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db";
import {
	CUSTOM_BLOCK_USAGES,
	customBlockIconTypeEnum,
	customBlockSourceTypeEnum,
	customBlocksListEntity,
	type VersionSnapshot,
} from "../../../db/schema";
import {
	backupHistorySchema,
	exportHistory,
	freshCanvasIds,
	importHistory,
} from "../../versions/backup";
import { buildSnapshot, restoreSnapshot } from "../../versions/snapshot";
import type { BackupModule } from "../types";

/**
 * Every custom block of a project (#1099): its live fields, its working copy,
 * and its promoted version (all its versions with version history). A canvas
 * calls another custom block by name (the block's `type`), so nothing inside a
 * snapshot needs translating; only canvas ids are made fresh on restore.
 */

const blockSchema = z.object({
	name: z.string().min(1),
	label: z.string(),
	description: z.string().nullable().default(null),
	icon: z.enum(customBlockIconTypeEnum.enumValues).nullable().default(null),
	iconUrl: z.string().nullable().default(null),
	sourceType: z.enum(customBlockSourceTypeEnum.enumValues).nullable().default("user-defined"),
	source: z.string().nullable().default(""),
	usage: z.enum(CUSTOM_BLOCK_USAGES).default("flow"),
	docs: z.string().nullable().default(null),
	history: backupHistorySchema,
});

const schema = z.object({ blocks: z.array(blockSchema) });
type Section = z.infer<typeof schema>;

const same = (snapshot: VersionSnapshot) => snapshot;

export const customBlocksModule: BackupModule<Section> = {
	name: "customBlocks",
	version: 1,
	minSupported: 1,
	upgrades: {},
	// a block's canvas may name integrations; add "integrations" here once #1100 registers it
	dependsOn: [],
	schema,

	async export({ projectId, options }) {
		const blocks = await db.transaction(async (tx) => {
			const rows = await tx
				.select()
				.from(customBlocksListEntity)
				.where(eq(customBlocksListEntity.projectId, projectId))
				.orderBy(asc(customBlocksListEntity.createdAt));
			const out: Section["blocks"] = [];
			for (const row of rows) {
				const working = await buildSnapshot("custom_block", row.id, tx);
				out.push({
					name: row.name,
					label: row.label,
					description: row.description,
					icon: row.icon,
					iconUrl: row.iconUrl,
					sourceType: row.sourceType,
					source: row.source,
					usage: row.usage,
					docs: row.docs,
					history: await exportHistory(
						"custom_block",
						row.id,
						working,
						options.includeVersionHistory,
						same,
						tx,
					),
				});
			}
			return out;
		});
		return { data: { blocks } };
	},

	async import({ tx, projectId, ids }, { blocks }) {
		for (const { history: raw, ...fields } of blocks) {
			const history = freshCanvasIds(raw);
			const [row] = await tx
				.insert(customBlocksListEntity)
				.values({ ...fields, projectId })
				.returning({ id: customBlocksListEntity.id });
			const target = { id: row!.id, projectId };
			// the working copy goes through the same path a checkout does
			await restoreSnapshot("custom_block", target, history.working as VersionSnapshot, tx);
			await importHistory("custom_block", target, history, same, tx);
			ids.set("customBlocks", fields.name, target.id);
		}
	},
};
