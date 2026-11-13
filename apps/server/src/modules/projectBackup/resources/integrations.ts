import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { integrationGroupNameSchema } from "../../../api/v1/integrations/schemas";
import { db } from "../../../db";
import { CHAN_ON_INTEGRATION_CHANGE, publishMessage } from "../../../db/redis";
import { integrationsEntity } from "../../../db/schema";
import type { BackupModule } from "../types";

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

export const integrationsModule: BackupModule<Section> = {
	name: "integrations",
	version: 1,
	minSupported: 1,
	upgrades: {},
	// config may name app config keys (`cfg:KEY`)
	dependsOn: ["appConfig"],
	schema,

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

	async import({ tx, projectId, mode, ids, afterCommit }, { integrations }) {
		for (const raw of integrations) {
			// blank whatever a hand-made template carries, too
			const row = mode === "template" ? forTemplate(raw) : raw;
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
