import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db";
import { CHAN_ON_APPCONFIG_CHANGE, publishMessage } from "../../../db/redis";
import { appConfigDataTypeEnum, appConfigEntity, encodingTypeEnum } from "../../../db/schema";
import type { BackupModule } from "../types";
import { byName } from "./rollback";

/**
 * A project's app config (#1100). The keys always travel, with their
 * description, data type, encoding and whether they are encrypted. The values
 * (production, development, `syncDev`) travel only in a backup that asked for
 * them (`includeAppConfigValues`; never in a template), exactly as stored: the
 * archive opens only with the same MASTER_ENCRYPTION_KEY, so an encrypted value
 * decrypts after the restore as it did before.
 *
 * A key restored without a value has none in either environment, as a key
 * whose value was never set: a run that reads it fails and names the key
 * (`MissingEnvValueError`), and a promotion's values gate lists it.
 */

const keySchema = z.object({
	// the column's limits, not the create form's pattern: an older key that predates it must still back up
	keyName: z.string().min(1).max(100),
	description: z.string().nullable().default(null),
	dataType: z.enum(appConfigDataTypeEnum.enumValues).default("string"),
	encodingType: z.enum(encodingTypeEnum.enumValues).default("plaintext"),
	isEncrypted: z.boolean().default(false),
	/** the stored (encoded, maybe encrypted) value; absent when values were left out */
	value: z.string().nullable().default(null),
	devValue: z.string().nullable().default(null),
	syncDev: z.boolean().default(false),
});

const schema = z.object({ keys: z.array(keySchema) });
type Section = z.infer<typeof schema>;

export const appConfigModule: BackupModule<Section> = {
	name: "appConfig",
	version: 1,
	minSupported: 1,
	upgrades: {},
	dependsOn: [],
	schema,

	// whether a value is there, never the value
	preview: ({ keys }) =>
		keys.map((k) => ({
			name: k.keyName,
			summary: k.description ?? undefined,
			details: {
				"Data type": k.dataType,
				Encrypted: k.isEncrypted,
				"Production value": k.value === null ? "Not set" : "Included",
				"Development value":
					k.devValue !== null ? "Included" : k.syncDev ? "Same as production" : "Not set",
			},
		})),

	names: ({ keys }) => keys.map((k) => k.keyName),

	async existing(projectId, tx) {
		const rows = await tx
			.select({ id: appConfigEntity.id, name: appConfigEntity.keyName })
			.from(appConfigEntity)
			.where(eq(appConfigEntity.projectId, projectId))
			.orderBy(asc(appConfigEntity.id));
		return byName(rows.map((r) => ({ id: String(r.id), name: r.name })));
	},

	async prune({ tx, afterCommit }, stale) {
		if (!stale.length) return;
		await tx.delete(appConfigEntity).where(
			inArray(
				appConfigEntity.id,
				stale.map((s) => Number(s.id)),
			),
		);
		afterCommit(
			() => publishMessage(CHAN_ON_APPCONFIG_CHANGE, "").then(() => {}),
			"The removed app config keys may still be cached by this server until the admin restarts.",
		);
	},

	async export({ projectId, mode, options }) {
		const values = mode === "backup" && options.includeAppConfigValues;
		const rows = await db
			.select()
			.from(appConfigEntity)
			.where(eq(appConfigEntity.projectId, projectId))
			.orderBy(asc(appConfigEntity.id));
		const keys = rows.map((r) => ({
			keyName: r.keyName ?? "",
			description: r.description,
			dataType: r.dataType ?? "string",
			encodingType: r.encodingType ?? "plaintext",
			isEncrypted: r.isEncrypted ?? false,
			...(values ? { value: r.value, devValue: r.devValue, syncDev: r.syncDev } : {}),
		}));
		return { data: schema.parse({ keys }) };
	},

	async import({ tx, projectId, mode, afterCommit, match, restoreSecrets }, { keys }) {
		if (!keys.length) return;
		// a hand-made template carries no value either
		const rows = mode === "template" ? keys.map(withoutValues) : keys;
		const added = [];
		for (const key of rows) {
			const matched = match(key.keyName);
			if (!matched) added.push({ ...key, projectId });
			// a rollback keeps today's value and what describes it (type, encoding), unless asked
			// for the backup's; a key the backup holds no value for keeps today's either way
			else
				await tx
					.update(appConfigEntity)
					.set(restoreSecrets && carriesValue(key) ? key : { description: key.description })
					.where(eq(appConfigEntity.id, Number(matched)));
		}
		if (added.length) await tx.insert(appConfigEntity).values(added);
		afterCommit(
			() => publishMessage(CHAN_ON_APPCONFIG_CHANGE, "").then(() => {}),
			"The restored app config may not be picked up by this server until a key is saved or the admin restarts.",
		);
	},
};

/** a backup made without values (`includeAppConfigValues` off) has none to restore */
const carriesValue = (key: Section["keys"][number]) =>
	key.value !== null || key.devValue !== null || key.syncDev;

const withoutValues = (key: Section["keys"][number]) => ({
	...key,
	value: null,
	devValue: null,
	syncDev: false,
});
