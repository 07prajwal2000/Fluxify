import { z } from "zod";
import { projectSettingsKeySchemaMap } from "../settings/keys/keySchemaMap";

/** Settings a project can be given at creation time.
 *
 *  Deliberately NOT every key in `projectSettingsKeySchemaMap`: the connection-id
 *  keys (AI agent, telemetry destinations) need integration wiring — a live
 *  connection test and the harness opt-in — that only `settings/keys/upsert`
 *  performs. Those are configured inside the project, once integrations exist.
 *  A new non-connection config key becomes available to the creation wizard by
 *  adding it to the map and to this list; nothing else changes. */
export const CREATE_TIME_SETTING_KEYS = [
	"experimental.workerTimeouts.enabled",
] as const;

export type CreateTimeSettingKey = (typeof CREATE_TIME_SETTING_KEYS)[number];

const settingsSchema = z.object(
	Object.fromEntries(
		CREATE_TIME_SETTING_KEYS.map((key) => [
			key,
			projectSettingsKeySchemaMap[key].schema.optional(),
		]),
	) as {
		[K in CreateTimeSettingKey]: z.ZodOptional<
			(typeof projectSettingsKeySchemaMap)[K]["schema"]
		>;
	},
);

const memberSchema = z.object({
	userId: z.string().min(1),
	role: z.enum(["viewer", "creator", "project_admin"]),
});

export const requestBodySchema = z.object({
	// 50, not 100: `projects.name` is varchar(50), so a longer name passed
	// validation and then died on the insert.
	name: z.string().min(2).max(50),
	description: z.string().max(1000).optional(),
	members: z
		.array(memberSchema)
		.optional()
		.refine(
			(members) =>
				!members || new Set(members.map((m) => m.userId)).size === members.length,
			{ message: "A user can only be added to the project once" },
		),
	settings: settingsSchema.optional(),
});

export const responseSchema = z.object({ id: z.string() });
