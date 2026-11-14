import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db";
import { CHAN_ON_APPCONFIG_CHANGE, publishMessage } from "../../../db/redis";
import { appConfigDataTypeEnum, appConfigEntity, encodingTypeEnum } from "../../../db/schema";
import type { BackupModule } from "../types";

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

	async import({ tx, projectId, mode, afterCommit }, { keys }) {
		if (!keys.length) return;
		// a hand-made template carries no value either
		const rows = mode === "template" ? keys.map(withoutValues) : keys;
		await tx.insert(appConfigEntity).values(rows.map((k) => ({ ...k, projectId })));
		afterCommit(
			() => publishMessage(CHAN_ON_APPCONFIG_CHANGE, "").then(() => {}),
			"The restored app config may not be picked up by this server until a key is saved or the admin restarts.",
		);
	},
};

const withoutValues = (key: Section["keys"][number]) => ({
	...key,
	value: null,
	devValue: null,
	syncDev: false,
});
