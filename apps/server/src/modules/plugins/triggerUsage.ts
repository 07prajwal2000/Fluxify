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
	/** the scalar values it sets, by param: an integration param's id, or a number param's value */
	values?: Record<string, string | number>;
};

/** a stored params object's scalar values, for an integration id and a number param's bounds */
export const scalarValues = (params: Record<string, unknown>) =>
	Object.fromEntries(
		Object.entries(params).filter(
			(entry): entry is [string, string | number] =>
				typeof entry[1] === "string" || typeof entry[1] === "number",
		),
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
			values: scalarValues((r.source ?? {}) as Record<string, unknown>),
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
