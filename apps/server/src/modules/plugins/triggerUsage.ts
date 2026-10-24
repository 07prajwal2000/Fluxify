import { and, eq, like } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import { triggersEntity } from "../../db/schema";
import { ConflictError } from "../../errors/conflictError";
import { pluginTriggerKind, pluginTriggerType } from "../triggers/types";

/** a trigger row of one of a plugin's kinds, with the params its `source` sets */
export type TriggerUser = {
	id: string;
	name: string;
	kind: string;
	params: string[];
	/** the string values it sets, by param: an integration param's id among them */
	values?: Record<string, string>;
};

/** a stored params object's string values, for what an integration param points at */
export const stringValues = (params: Record<string, unknown>) =>
	Object.fromEntries(
		Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"),
	);

/** every trigger row of plugin `name`'s kinds: type `plugin:<name>/…` */
export const pluginTriggerRows = (projectId: string, name: string, tx?: DbTransactionType) =>
	(tx ?? db)
		.select()
		.from(triggersEntity)
		.where(
			and(
				eq(triggersEntity.projectId, projectId),
				// `_` is a LIKE wildcard, and plugin names hold it
				like(triggersEntity.type, `${pluginTriggerType(name).replace(/[\\%_]/g, "\\$&")}/%`),
			),
		);

/** the plugin's trigger rows as users of its kinds, for removal and the upgrade diff */
export async function pluginTriggerUsers(projectId: string, name: string): Promise<TriggerUser[]> {
	return (await pluginTriggerRows(projectId, name))
		.map((r) => ({
			id: r.id,
			name: r.name,
			kind: pluginTriggerKind(r.type),
			params: Object.entries((r.source ?? {}) as Record<string, unknown>)
				.filter(([, v]) => v !== undefined && v !== null)
				.map(([k]) => k),
			values: stringValues((r.source ?? {}) as Record<string, unknown>),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** The 409 of a remove refused while triggers of the plugin's kinds exist. */
export class TriggersInUseError extends ConflictError {
	constructor(plugin: string, users: TriggerUser[]) {
		super(
			`Plugin ${plugin} still provides triggers ${users.map((u) => `"${u.name}" (${u.kind})`).join(", ")}. Delete them first.`,
		);
		this.details = { triggers: users.map(({ id, name, kind }) => ({ id, name, kind })) };
	}
}
