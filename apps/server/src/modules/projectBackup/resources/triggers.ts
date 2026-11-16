import { and, asc, eq, getTableColumns, inArray, isNull, notInArray } from "drizzle-orm";
import { z } from "zod";
import { maxTriggersPerGroup } from "../../../api/v1/triggers/groupCap";
import { ensureDefaultGroup } from "../../../api/v1/triggers/repository";
import { republish, withdraw } from "../../../api/v1/triggers/service";
import { type DbTransactionType, db } from "../../../db";
import { triggerGroupsEntity, triggersEntity, workflowsEntity } from "../../../db/schema";
import { BadRequestError } from "../../../errors/badRequestError";
import { removeScheduleEverywhere } from "../../schedules/reconciler";
import type { BackupModule } from "../types";
import { missingPluginWarnings, pluginOf, productionOff } from "./canvas";
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
import { onOff, production } from "./preview";
import { byName, integrationUses } from "./rollback";

/**
 * A project's trigger groups and triggers (#1098), in one section: a trigger
 * cannot exist without its group, and a group holds nothing else. A trigger
 * names its group and its workflow by name. A sandbox's trigger is left out,
 * as sandboxes are.
 *
 * Restored rows reach workers after the commit (`afterCommit`): each trigger is
 * republished as a save would, which registers a schedule in NATS or puts a
 * queue trigger's artifact, in each environment its workflow is live in. The
 * project compile does not do this, and a NATS write inside the transaction
 * would outlive a rollback. One that fails comes back as a restore warning.
 *
 * The group cap (`MAX_TRIGGERS_PER_GROUP`) is not enforced: every trigger
 * restores as it was, and `inspect` warns about each group over it. An
 * over-cap group still saves and runs; it only refuses new triggers.
 *
 * `integrationId`, and integration ids among a plugin trigger's `source`
 * params, resolve through the section's integration table (#1100, v2). A
 * trigger whose integration doesn't resolve restores with it blank and both
 * switches off, with a `disabledReason`, as when its queue is deleted: turning
 * it back on checks the connector again.
 */

export const LOST_INTEGRATION =
	"Its integration wasn't in the backup it was restored from. Choose one, then turn it on.";

const groupSchema = z.object({
	name: z.string().min(1),
	description: z.string().nullable().default(null),
	isDefault: z.boolean().default(false),
});

const triggerSchema = z.object({
	name: z.string().min(1),
	description: z.string().nullable().default(null),
	type: z.string().min(1),
	/** the workflow's name; null is a saved, idle trigger */
	workflow: z.string().nullable().default(null),
	group: z.string().min(1),
	integrationId: z.string().nullable().default(null),
	batchSize: z.number().int().default(1),
	maxWaitMs: z.number().int().default(0),
	maxBytes: z.number().int().default(1048576),
	concurrency: z.number().int().default(1),
	payload: z.unknown().default(null),
	source: z.unknown().default(null),
	commitMode: z.string().default("auto"),
	maxAttempts: z.number().int().default(3),
	retryDelayMs: z.number().int().default(1000),
	schedule: z.string().nullable().default(null),
	timezone: z.string().default("UTC"),
	active: z.boolean().default(false),
	devActive: z.boolean().default(false),
	disabledReason: z.string().nullable().default(null),
});

const schema = z.object({
	groups: z.array(groupSchema).default([]),
	triggers: z.array(triggerSchema).default([]),
	integrations: integrationTableSchema,
});
type Section = z.infer<typeof schema>;

/** another instance's cap, or a cap lowered since: restore as is, and say so */
function overCap(triggers: Section["triggers"]) {
	const cap = maxTriggersPerGroup();
	const counts = new Map<string, number>();
	for (const { group } of triggers) counts.set(group, (counts.get(group) ?? 0) + 1);
	return [...counts]
		.filter(([, n]) => n > cap)
		.map(
			([group, n]) =>
				`Group "${group}" has ${n} triggers; this instance allows ${cap} per group (MAX_TRIGGERS_PER_GROUP). They will all be restored, so this group will be over the limit. You can't add more triggers to it until it is back under.`,
		);
}

/** off the workers wherever it was: a schedule in NATS, or a queue trigger's artifact */
const unregister = (row: { projectId: string; id: string; type: string }) =>
	row.type === "schedule"
		? removeScheduleEverywhere(row.projectId, row.id)
		: withdraw(row.projectId, row.id);

/** the project's own triggers; a sandbox's are never backed up, so never matched or pruned */
const ownTriggers = (projectId: string) =>
	and(eq(triggersEntity.projectId, projectId), isNull(triggersEntity.sandboxId));

/** group name → id, made or updated as the backup has it */
async function writeGroups(
	tx: DbTransactionType,
	projectId: string,
	groups: Section["groups"],
): Promise<Map<string, string>> {
	const have = byName(
		await tx
			.select({ id: triggerGroupsEntity.id, name: triggerGroupsEntity.name })
			.from(triggerGroupsEntity)
			.where(eq(triggerGroupsEntity.projectId, projectId)),
	);
	const groupIds = new Map<string, string>();
	for (const { isDefault, ...group } of groups) {
		const matched = have.get(group.name);
		// one default per project, wherever the project got it from
		if (isDefault) groupIds.set(group.name, await ensureDefaultGroup(projectId, undefined, tx));
		else if (matched) {
			await tx
				.update(triggerGroupsEntity)
				.set({ description: group.description })
				.where(eq(triggerGroupsEntity.id, matched));
			groupIds.set(group.name, matched);
		} else {
			const [row] = await tx
				.insert(triggerGroupsEntity)
				.values({ ...group, projectId })
				.returning({ id: triggerGroupsEntity.id });
			groupIds.set(group.name, row!.id);
		}
	}
	return groupIds;
}

export const triggersModule: BackupModule<Section> = {
	name: "triggers",
	version: 2,
	minSupported: 1,
	upgrades: {
		// v1 kept integration ids with no names
		1: (data) => ({ ...(data as object), integrations: v1Table(data, { sourceParams: true }) }),
	},
	// a trigger starts a workflow, never a route; a plugin trigger's plugin is in place before `afterCommit` republishes it
	dependsOn: ["integrations", "plugins", "workflows"],
	schema,

	preview: ({ triggers }, mode) =>
		triggers.map((t) => ({
			name: t.name,
			summary: t.workflow ? `${t.type} → ${t.workflow}` : t.type,
			details: {
				Type: t.type,
				Workflow: t.workflow ?? "None",
				Group: t.group,
				Schedule: t.schedule ? `${t.schedule} (${t.timezone})` : null,
				Production: production(t.active, mode),
				Development: onOff(t.devActive),
				...(t.disabledReason ? { "Turned off because": t.disabledReason } : {}),
			},
		})),

	names: ({ triggers }) => triggers.map((t) => t.name),

	async existing(projectId, tx) {
		return byName(
			await tx
				.select({ id: triggersEntity.id, name: triggersEntity.name })
				.from(triggersEntity)
				.where(ownTriggers(projectId))
				.orderBy(asc(triggersEntity.createdAt)),
		);
	},

	uses: ({ triggers, integrations }) =>
		triggers.flatMap((t) => {
			const owner = `Trigger "${t.name}"`;
			const plugin = pluginOf(t.type);
			return [
				...(t.workflow ? [{ owner, section: "workflows", name: t.workflow }] : []),
				...(plugin ? [{ owner, section: "plugins", name: plugin }] : []),
				...integrationUses(owner, [t.integrationId, t.source], integrations),
			];
		}),

	/** the triggers the backup lacks, then the groups it lacks once nothing runs in them */
	async prune({ tx, projectId, afterCommit }, stale, data) {
		if (stale.length) {
			const rows = await tx
				.delete(triggersEntity)
				.where(
					inArray(
						triggersEntity.id,
						stale.map((s) => s.id),
					),
				)
				.returning();
			for (const row of rows)
				afterCommit(
					() => unregister(row),
					`Trigger "${row.name}" was removed, but it may keep running until the admin restarts.`,
				);
		}
		const kept = data.groups.map((g) => g.name);
		const busy = tx
			.select({ id: triggersEntity.groupId })
			.from(triggersEntity)
			.where(eq(triggersEntity.projectId, projectId));
		await tx
			.delete(triggerGroupsEntity)
			.where(
				and(
					eq(triggerGroupsEntity.projectId, projectId),
					eq(triggerGroupsEntity.isDefault, false),
					kept.length ? notInArray(triggerGroupsEntity.name, kept) : undefined,
					notInArray(triggerGroupsEntity.id, busy),
				),
			);
	},

	inspect({ triggers, integrations }, read) {
		const have = restoredNames(read);
		return [
			...overCap(triggers),
			...triggers.flatMap((t) =>
				lostWarnings(
					`Trigger "${t.name}"`,
					[{ where: "its connector", value: [t.integrationId, t.source] }],
					integrations,
					have,
					"It is restored switched off with that integration blank; choose one, then turn it on.",
				),
			),
			...triggers.flatMap((t) =>
				missingPluginWarnings(
					`Trigger "${t.name}"`,
					[{ where: "its kind", type: t.type }],
					read,
					"It is restored, but it doesn't run until you install and approve the plugin.",
				),
			),
		];
	},

	async export({ projectId }) {
		return await db.transaction(async (tx) => {
			const groups = await tx
				.select()
				.from(triggerGroupsEntity)
				.where(eq(triggerGroupsEntity.projectId, projectId))
				.orderBy(asc(triggerGroupsEntity.createdAt));
			const groupName = new Map(groups.map((g) => [g.id, g.name]));
			const rows = await tx
				.select({ ...getTableColumns(triggersEntity), workflow: workflowsEntity.name })
				.from(triggersEntity)
				.leftJoin(workflowsEntity, eq(workflowsEntity.id, triggersEntity.workflowId))
				.where(and(eq(triggersEntity.projectId, projectId), isNull(triggersEntity.sandboxId)))
				.orderBy(asc(triggersEntity.createdAt));
			const triggers = rows.map(
				({ id: _, projectId: __, workflowId: ___, sandboxId: ____, groupId, ...t }) => ({
					...t,
					group: groupName.get(groupId)!,
				}),
			);
			const names = await integrationNames(projectId, tx);
			return {
				data: {
					groups: groups.map((g) => ({
						name: g.name,
						description: g.description,
						isDefault: g.isDefault,
					})),
					triggers,
					integrations: tableFor(triggers, names),
				},
			};
		});
	},

	async import(
		{ tx, projectId, mode, ids, match, afterCommit },
		{ groups, triggers, integrations },
	) {
		const groupIds = await writeGroups(tx, projectId, groups);

		const resolve = localIntegrations(integrations, ids);
		for (const trigger of triggers) {
			let lost = false;
			const { workflow, group, ...fields } = remapIntegrations(trigger, (value) => {
				const id = resolve(value);
				if (id === "") lost = true;
				return id;
			});
			if (lost)
				Object.assign(fields, {
					integrationId: fields.integrationId || null,
					active: false,
					devActive: false,
					disabledReason: LOST_INTEGRATION,
				});
			const groupId = groupIds.get(group);
			if (!groupId)
				throw new BadRequestError(
					`Trigger "${fields.name}" runs in the group "${group}", which isn't in this backup.`,
				);
			const workflowId = workflow ? ids.get("workflows", workflow) : null;
			// a trigger aimed at nothing would sit idle where it used to fire
			if (workflowId === undefined)
				throw new BadRequestError(
					`Trigger "${fields.name}" starts the workflow "${workflow}", which isn't in this backup.`,
				);
			const values = { ...fields, ...productionOff(mode), projectId, groupId, workflowId };
			// a rollback keeps the trigger's id, so its run history stays with it
			const matched = match(fields.name);
			const [before] = matched
				? await tx.select().from(triggersEntity).where(eq(triggersEntity.id, matched))
				: [];
			const [row] = matched
				? await tx
						.update(triggersEntity)
						.set(values)
						.where(eq(triggersEntity.id, matched))
						.returning()
				: await tx.insert(triggersEntity).values(values).returning();
			// one at a time, so one that fails does not hold the rest back
			afterCommit(async () => {
				// a schedule turned queue trigger (or back) leaves its old registration behind
				if (before && before.type !== row!.type) await unregister(before);
				await republish(row!);
			}, `Trigger "${row!.name}" could not be activated. Open it and save it once.`);
		}
	},
};
