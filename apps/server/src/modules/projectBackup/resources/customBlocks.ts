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
import { BLANK_BLOCK, canvasPlaces } from "./canvas";
import {
	integrationNames,
	integrationTableSchema,
	localIntegrations,
	lostWarnings,
	remapIntegrations,
	restoredNames,
	tableFor,
	v1Table,
} from "./integrationRefs";

/**
 * Every custom block of a project (#1099): its live fields, its working copy,
 * and its promoted version (all its versions with version history). A canvas
 * calls another custom block by name (the block's `type`), so that needs no
 * translating; canvas ids are made fresh on restore, and integration ids in
 * block data resolve through the section's integration table (#1100, v2).
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

const schema = z.object({ blocks: z.array(blockSchema), integrations: integrationTableSchema });
type Section = z.infer<typeof schema>;

const same = (snapshot: VersionSnapshot) => snapshot;

export const customBlocksModule: BackupModule<Section> = {
	name: "customBlocks",
	version: 2,
	minSupported: 1,
	upgrades: {
		// v1 kept integration ids with no names
		1: (data) => ({ ...(data as object), integrations: v1Table(data) }),
	},
	dependsOn: ["integrations"],
	schema,

	inspect({ blocks, integrations }, read) {
		const have = restoredNames(read);
		return blocks.flatMap((b) =>
			lostWarnings(
				`Custom block "${b.name}"`,
				canvasPlaces(b.history),
				integrations,
				have,
				BLANK_BLOCK,
			),
		);
	},

	async export({ projectId, options }) {
		return await db.transaction(async (tx) => {
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
			const names = await integrationNames(projectId, tx);
			return { data: { blocks: out, integrations: tableFor(out, names) } };
		});
	},

	async import({ tx, projectId, ids }, { blocks, integrations }) {
		const lookup = localIntegrations(integrations, ids);
		for (const block of blocks) {
			const { history: raw, ...fields } = remapIntegrations(block, lookup);
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
