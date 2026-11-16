import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { integrationGroupNameSchema } from "../../../api/v1/integrations/schemas";
import { db } from "../../../db";
import { CHAN_ON_INTEGRATION_CHANGE, publishMessage } from "../../../db/redis";
import { integrationsEntity, projectsEntity } from "../../../db/schema";
import type { BackupModule } from "../types";
import { byName } from "./rollback";

/**
 * A project's integrations (#1100), production and development config both,
 * by name: every other section names them through its integration table
 * (`integrationRefs.ts`), and resolves them with `ids.get("integrations", name)`.
 *
 * A **backup** keeps the config exactly as stored. The archive opens only with
 * the same MASTER_ENCRYPTION_KEY, so what is sealed in it (an MCP server's OAuth
 * tokens) is still readable after the restore.
 *
 * A **template** keeps the shape and blanks the credentials: every string that
 * is not a `cfg:` app config reference becomes "", and an MCP sign-in is
 * dropped. No variant marks which of its fields are secret, so all literal text
 * goes. Development gets no config of its own and stops sharing production's,
 * the state the portal already shows as "Dev workers will fail until you set a
 * development value".
 *
 * Config is not run through the variant's schema: blank credentials would fail
 * it (it is what a save checks), a plugin's variant is unknown until plugins are
 * restored, and a backup's config passed it when it was saved. The group is
 * checked as the create path checks it.
 */

const config = z.record(z.string(), z.unknown());

const integrationSchema = z.object({
	// not trimmed, as the create form does: the other sections name it exactly as stored
	name: z.string().max(255),
	group: integrationGroupNameSchema,
	variant: z.string().min(1),
	config: config.nullable().default(null),
	devConfig: config.nullable().default(null),
	syncDev: z.boolean().default(false),
	tags: z.string().default(""),
});

const schema = z.object({ integrations: z.array(integrationSchema) });
type Section = z.infer<typeof schema>;

/** a template's config: the same keys, literal text blanked, `cfg:` references kept */
export function blankCredentials(value: unknown): unknown {
	if (typeof value === "string") return value.startsWith("cfg:") ? value : "";
	if (Array.isArray(value)) return value.map(blankCredentials);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				// an MCP server's sign-in: sealed tokens, and nothing to blank them to
				.filter(([key]) => key !== "oauth")
				.map(([key, v]) => [key, blankCredentials(v)]),
		);
	return value;
}

type Row = Section["integrations"][number];
const forTemplate = (row: Row): Row => ({
	...row,
	config: row.config && (blankCredentials(row.config) as Row["config"]),
	devConfig: null,
	syncDev: false,
});

type Config = Row["config"];
const withoutOAuth = (config: Config): Config => {
	if (!config || !("oauth" in config)) return config;
	const { oauth: _, ...rest } = config;
	return rest;
};
/** the same row with no MCP sign-in in either environment; the row itself when it had none */
function signedOut(row: Row): Row {
	const config = withoutOAuth(row.config);
	const devConfig = withoutOAuth(row.devConfig);
	return config === row.config && devConfig === row.devConfig ? row : { ...row, config, devConfig };
}

export const integrationsModule: BackupModule<Section> = {
	name: "integrations",
	version: 1,
	minSupported: 1,
	upgrades: {},
	// config may name app config keys (`cfg:KEY`)
	dependsOn: ["appConfig"],
	schema,

	// the kind of connection, never its config
	preview: ({ integrations }, mode) =>
		integrations.map((i) => ({
			name: i.name,
			summary: `${i.group} · ${i.variant}`,
			details: {
				Group: i.group,
				Variant: i.variant,
				Tags: i.tags || null,
				Production: !i.config
					? "Not set"
					: mode === "template"
						? "Credentials left blank"
						: "Included",
				Development:
					mode === "template"
						? "Not set"
						: i.devConfig
							? "Its own"
							: i.syncDev
								? "Same as production"
								: "Not set",
			},
		})),

	names: ({ integrations }) => integrations.map((i) => i.name),

	async existing(projectId, tx) {
		return byName(
			await tx
				.select({ id: integrationsEntity.id, name: integrationsEntity.name })
				.from(integrationsEntity)
				.where(eq(integrationsEntity.projectId, projectId))
				.orderBy(asc(integrationsEntity.createdAt)),
		);
	},

	// config may read app config (`cfg:KEY`)
	uses: ({ integrations }) =>
		integrations.flatMap((i) => {
			const keys = new Set<string>();
			JSON.stringify([i.config, i.devConfig], (_, v) => {
				if (typeof v === "string" && v.startsWith("cfg:")) keys.add(v.slice(4));
				return v;
			});
			return [...keys].map((name) => ({
				owner: `Integration "${i.name}"`,
				section: "appConfig",
				name,
			}));
		}),

	async prune({ tx, afterCommit }, stale) {
		if (!stale.length) return;
		// the triggers reading through one cascade with it; a rollback refuses that unless their section is restored too
		await tx.delete(integrationsEntity).where(
			inArray(
				integrationsEntity.id,
				stale.map((s) => s.id),
			),
		);
		afterCommit(
			() => publishMessage(CHAN_ON_INTEGRATION_CHANGE, "").then(() => {}),
			"The removed integrations may still be cached by this server until the admin restarts.",
		);
	},

	async export({ projectId, mode }) {
		const rows = await db
			.select()
			.from(integrationsEntity)
			.where(eq(integrationsEntity.projectId, projectId))
			.orderBy(asc(integrationsEntity.createdAt));
		const integrations = rows.map((r) => ({
			name: r.name ?? "",
			group: (r.group ?? "") as Row["group"],
			variant: r.variant ?? "",
			config: r.config as Row["config"],
			devConfig: r.devConfig as Row["devConfig"],
			syncDev: r.syncDev,
			tags: r.tags ?? "",
		}));
		return {
			data: { integrations: mode === "template" ? integrations.map(forTemplate) : integrations },
		};
	},

	async import(ctx, { integrations }) {
		const { tx, projectId, mode, source, ids, afterCommit, warn, match, restoreSecrets } = ctx;
		// Next to its source, both copies would share one MCP sign-in: a provider that
		// rotates refresh tokens then signs one of them out on the other's refresh.
		// Another instance (disaster recovery) has no source to share it with.
		const besideSource =
			mode === "backup" &&
			(
				await tx
					.select({ id: projectsEntity.id })
					.from(projectsEntity)
					.where(and(eq(projectsEntity.slug, source.slug), ne(projectsEntity.id, projectId)))
					.limit(1)
			).length > 0;
		for (const raw of integrations) {
			// blank whatever a hand-made template carries, too
			const row = mode === "template" ? forTemplate(raw) : besideSource ? signedOut(raw) : raw;
			if (besideSource && row !== raw) warn(`MCP server "${row.name}" needs signing in again.`);
			const matched = match(row.name);
			if (matched) {
				// a rollback keeps today's credentials, unless asked for the backup's
				await tx
					.update(integrationsEntity)
					.set(restoreSecrets ? row : { tags: row.tags })
					.where(eq(integrationsEntity.id, matched));
				ids.set("integrations", row.name, matched);
				continue;
			}
			const [created] = await tx
				.insert(integrationsEntity)
				.values({ ...row, projectId })
				.returning({ id: integrationsEntity.id });
			ids.set("integrations", row.name, created!.id);
		}
		// the admin's own caches (canvas checks, the agent) reload, as after a create
		if (integrations.length)
			afterCommit(
				() => publishMessage(CHAN_ON_INTEGRATION_CHANGE, "").then(() => {}),
				"The restored integrations may not be picked up by this server until one of them is saved or the admin restarts.",
			);
	},
};
