import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db";
import { systemUsers } from "../../../db/auth-schema";
import { deleteArtifact } from "../../../db/natsKv";
import { pluginObjects } from "../../../db/natsObjects";
import {
	PLUGIN_APPROVALS,
	PLUGIN_SOURCES,
	pluginsEntity,
	pluginUrlRequestsEntity,
} from "../../../db/schema";
import { ENVIRONMENTS } from "../../../lib/envValues";
import { pluginKey } from "../../compiler/subjects";
import { listPluginRows } from "../../plugins/repository";
import { pluginObjectKey } from "../../plugins/sources/location";
import { syncProjectPluginVariants } from "../../plugins/variants";
import type { BackupModule } from "../types";
import { checkedTarball, exportTarball, restoredSource, tarballPath } from "./pluginBytes";
import { byName } from "./rollback";

/**
 * A project's plugins (#1101): each row, with the bytes of every version it
 * holds inside the archive (`pluginBytes.ts`), so a restore works offline.
 *
 * Approval is kept in a **backup**: its payload is sealed with
 * MASTER_ENCRYPTION_KEY (AES-GCM), so nobody without the key could have swapped
 * the code or the approval, and a restored plugin loads without approving it
 * again. A **template** is plain text anyone can edit, so every plugin in one
 * restores pending, and only its current version travels.
 *
 * Plugin permissions name integration kinds (`kv`), never an integration, so
 * this section holds no integration ids and doesn't depend on `integrations`.
 * The plugin's integration rows are the integrations section's; they resolve
 * once the plugin is restored and the project compiles.
 */

const permissions = z.object({ integrations: z.array(z.string()), appconfig: z.boolean() });

const versionSchema = z.object({
	version: z.string().min(1),
	source: z.enum(PLUGIN_SOURCES),
	location: z.string(),
	integrity: z.string().min(1),
	/** what loads is read from the bytes on restore; this copy is what `inspect` reads */
	manifest: z.looseObject({ name: z.string(), blocks: z.record(z.string(), z.unknown()) }),
	permissions: permissions.nullable().default(null),
});

const pluginSchema = versionSchema.extend({
	name: z.string().min(1),
	approval: z.enum(PLUGIN_APPROVALS),
	/** the approver's email: a user id means nothing on another instance */
	approvedBy: z.string().nullable().default(null),
	approvedAt: z.coerce.date().nullable().default(null),
	devEnabled: z.boolean().default(true),
	prodEnabled: z.boolean().default(false),
	/** the approved version a pending upgrade would replace (#860) */
	live: versionSchema.nullable().default(null),
});

const schema = z.object({ plugins: z.array(pluginSchema) });
type Section = z.infer<typeof schema>;
type Plugin = Section["plugins"][number];

const versionsOf = (p: Plugin) => [p, ...(p.live ? [p.live] : [])];

export const pluginsModule: BackupModule<Section> = {
	name: "plugins",
	version: 1,
	minSupported: 1,
	upgrades: {},
	dependsOn: [],
	schema,

	preview: ({ plugins }, mode) =>
		plugins.map((p) => ({
			name: p.name,
			summary: `v${p.version}`,
			details: {
				Version: p.version,
				Source: p.source,
				Approval: mode === "template" ? "Pending: needs approving again" : p.approval,
				Blocks: Object.keys(p.manifest.blocks).length,
				Development: p.devEnabled ? "Enabled" : "Disabled",
				Production: p.prodEnabled ? "Enabled" : "Disabled",
			},
		})),

	/** refuses here what the import would (integrity, SDK range), before the user fills anything in */
	async inspect({ plugins }, _read, { files, mode }) {
		for (const p of plugins)
			for (const v of mode === "template" ? [p] : versionsOf(p))
				await checkedTarball(p.name, v, files[tarballPath(p.name, v.version)]);
		if (mode !== "template") return [];
		return plugins.map(
			(p) => `Plugin "${p.name}" needs approving before routes that use its blocks will compile.`,
		);
	},

	names: ({ plugins }) => plugins.map((p) => p.name),

	async existing(projectId, tx) {
		return byName(
			await tx
				.select({ id: pluginsEntity.id, name: pluginsEntity.name })
				.from(pluginsEntity)
				.where(eq(pluginsEntity.projectId, projectId)),
		);
	},

	/** as removing a plugin does (`removePlugin`); its usage was refused before anything was written */
	async prune({ tx, projectId, afterCommit }, stale) {
		for (const { name, id } of stale) {
			await tx
				.delete(pluginUrlRequestsEntity)
				.where(
					and(
						eq(pluginUrlRequestsEntity.projectId, projectId),
						eq(pluginUrlRequestsEntity.pluginName, name),
					),
				);
			await tx.delete(pluginsEntity).where(eq(pluginsEntity.id, id));
			afterCommit(async () => {
				await Promise.all(
					ENVIRONMENTS.map((env) => deleteArtifact(pluginKey(projectId, name), env)),
				);
				const objects = await pluginObjects();
				for (const key of await objects.keys(`${projectId}/${name}/`)) await objects.delete(key);
				await syncProjectPluginVariants(projectId);
			}, `Plugin "${name}" was removed, but workers may keep loading it until the admin restarts.`);
		}
	},

	async export({ projectId, mode }) {
		const rows = await listPluginRows(projectId);
		const approvers = rows.flatMap((r) => (r.approvedBy ? [r.approvedBy] : []));
		const emails = new Map(
			approvers.length
				? (
						await db
							.select({ id: systemUsers.id, email: systemUsers.email })
							.from(systemUsers)
							.where(inArray(systemUsers.id, approvers))
					).map((u) => [u.id, u.email])
				: [],
		);
		const files: Record<string, Uint8Array> = {};
		const plugins: Plugin[] = [];
		for (const row of rows) {
			const plugin = {
				...row,
				approvedBy: (row.approvedBy && emails.get(row.approvedBy)) ?? null,
				live: mode === "template" ? null : row.live,
			};
			for (const v of versionsOf(plugin))
				files[tarballPath(row.name, v.version)] = await exportTarball(row.name, v);
			plugins.push(plugin);
		}
		return { data: { plugins }, files };
	},

	async import({ tx, projectId, mode, files, ids, match }, { plugins }) {
		const template = mode === "template";
		const restoring = plugins.map((p) => ({ ...p, live: template ? null : p.live }));
		// every version is checked before anything is written, here or in the Object Store
		const manifests = new Map<string, Awaited<ReturnType<typeof checkedTarball>>>();
		for (const p of restoring)
			for (const v of versionsOf(p)) {
				const path = tarballPath(p.name, v.version);
				manifests.set(path, await checkedTarball(p.name, v, files[path]));
			}

		const store = await pluginObjects();
		// ponytail: a rolled-back restore leaves these objects; the plugin scanner clears unreferenced ones
		const stored = async (name: string, v: Plugin | NonNullable<Plugin["live"]>) => {
			const path = tarballPath(name, v.version);
			const key = pluginObjectKey(projectId, name, v.version);
			await store.put(key, files[path]!);
			const manifest = manifests.get(path)!;
			return { version: v.version, manifest, ...restoredSource(v, key, files[path]!) };
		};
		for (const p of restoring) {
			const current = await stored(p.name, p);
			const live = p.live && { ...(await stored(p.name, p.live)), permissions: p.live.permissions };
			const approver =
				!template && p.approvedBy
					? (
							await tx
								.select({ id: systemUsers.id })
								.from(systemUsers)
								.where(eq(systemUsers.email, p.approvedBy))
						)[0]?.id
					: undefined;
			const values = {
				projectId,
				name: p.name,
				...current,
				url: current.manifest.url,
				sdkRange: current.manifest.sdk,
				approval: template ? "pending" : p.approval,
				approvedBy: approver ?? null,
				approvedAt: template ? null : p.approvedAt,
				permissions: template ? null : p.permissions,
				live,
				devEnabled: p.devEnabled,
				prodEnabled: p.prodEnabled,
			};
			// a rollback puts the backup's version back on the same row
			const matched = match(p.name);
			const [row] = matched
				? await tx
						.update(pluginsEntity)
						.set(values)
						.where(eq(pluginsEntity.id, matched))
						.returning({ id: pluginsEntity.id })
				: await tx.insert(pluginsEntity).values(values).returning({ id: pluginsEntity.id });
			ids.set("plugins", p.name, row!.id);
		}
	},
};
