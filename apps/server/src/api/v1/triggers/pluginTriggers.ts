import { paramsConfigSchema } from "@fluxify/sdk/integrations";
import type { TriggerEntry } from "@fluxify/sdk/triggers";
import { and, eq, like } from "drizzle-orm";
import { type DbTransactionType, db } from "../../../db";
import { triggersEntity } from "../../../db/schema";
import { ValidationError } from "../../../errors/validationError";
import type { FluxifyEnv } from "../../../lib/env";
import type { PluginTriggerArtifact } from "../../../modules/compiler/artifacts";
import { isUsableIn, liveOf } from "../../../modules/plugins/meta";
import { integrationParamProblem, projectIntegration } from "../../../modules/plugins/paramCheck";
import { listPluginRows } from "../../../modules/plugins/repository";
import { findTriggerKind } from "../../../modules/plugins/triggerKinds";
import { isPluginTriggerType, pluginTriggerKind } from "../../../modules/triggers/types";

/**
 * Plugin triggers (T2): a row of type `plugin:<kind>` whose params live in its
 * `source`. The admin knows the kind only from the approved manifest; nothing
 * here runs plugin code.
 */

type FieldError = { field: string; message: string };

export type PluginTriggerCheck = {
	type: string;
	projectId: string;
	integrationId?: string | null;
	source?: unknown;
	sandboxId?: string | null;
	/** a new row: refused while its plugin is off, which an existing row is not */
	creating?: boolean;
};

/**
 * A plugin trigger names a kind of an approved plugin of its project, takes no
 * `integrationId` of its own, and its params fit the kind's schema. Each error
 * names its field: `type`, `integrationId` or `source.<param>`.
 */
export async function assertPluginTrigger(check: PluginTriggerCheck, tx?: DbTransactionType) {
	const kind = pluginTriggerKind(check.type);
	const found = await findTriggerKind(check.projectId, kind, tx);
	if (!found)
		throw new ValidationError([
			{ field: "type", message: `No approved plugin of this project provides trigger ${kind}` },
		]);
	const { row, entry } = found;
	const errors: FieldError[] = [];
	// a sandbox runs on development workers only
	const on = isUsableIn(row, "development") || (!check.sandboxId && isUsableIn(row, "production"));
	if (check.creating && !on)
		errors.push({ field: "type", message: `plugin ${row.name} is disabled` });
	if (check.integrationId)
		errors.push({
			field: "integrationId",
			message: "A plugin trigger takes its integrations as params, in source",
		});
	// the body schema already holds `source` to an object
	const source = (check.source ?? {}) as Record<string, unknown>;
	errors.push(...(await paramErrors(entry, source, check.projectId, tx)));
	if (errors.length) throw new ValidationError(errors);
}

/** each param against its schema, the rules a block's params and an integration's secrets follow */
async function paramErrors(
	entry: TriggerEntry,
	source: Record<string, unknown>,
	projectId: string,
	tx?: DbTransactionType,
) {
	const errors: FieldError[] = [];
	for (const [name, param] of Object.entries(entry.params)) {
		const field = `source.${name}`;
		const parsed = paramsConfigSchema({ [name]: param }).safeParse({ [name]: source[name] });
		if (!parsed.success) {
			errors.push({ field, message: parsed.error.issues[0]!.message });
			continue;
		}
		const value = source[name];
		if (param.type !== "integration" || typeof value !== "string") continue;
		const found = await projectIntegration(value, projectId, tx);
		const owner = { label: `trigger ${entry.name}`, granted: entry.permissions.integrations ?? [] };
		const message = found
			? integrationParamProblem(owner, param, found)
			: `no integration ${value} in this project`;
		if (message) errors.push({ field, message });
	}
	return errors;
}

/**
 * What a plugin trigger's artifact adds, and where its plugin loads. Undefined
 * for any other type; null when no approved plugin provides the kind any more,
 * which withdraws the artifact everywhere.
 */
export async function pluginTriggerPart(trigger: { type: string; projectId: string }) {
	if (!isPluginTriggerType(trigger.type)) return undefined;
	const found = await findTriggerKind(trigger.projectId, pluginTriggerKind(trigger.type));
	if (!found) return null;
	const { row, entry } = found;
	const plugin: PluginTriggerArtifact = {
		kind: entry.name,
		name: row.name,
		version: row.version,
		integrity: row.integrity,
		retry: entry.retry,
	};
	return { plugin, servedIn: (env: FluxifyEnv) => isUsableIn(row, env) };
}

/**
 * The plugin triggers whose `source` names integration `id`. A param value is
 * matched, not its type: an integration id is a uuid no other param holds.
 */
export async function pluginTriggersUsing(projectId: string, id: string, tx?: DbTransactionType) {
	const rows = await (tx ?? db)
		.select({ id: triggersEntity.id, source: triggersEntity.source })
		.from(triggersEntity)
		.where(and(eq(triggersEntity.projectId, projectId), like(triggersEntity.type, "plugin:%")));
	return rows
		.filter((r) => Object.values((r.source ?? {}) as Record<string, unknown>).includes(id))
		.map((r) => r.id);
}

/** the ids of `rows` whose plugin is switched off in both environments: the list marks them */
export async function pluginDisabledIds(rows: { id: string; type: string; projectId: string }[]) {
	const plugins = rows.filter((r) => isPluginTriggerType(r.type));
	const disabled = new Set<string>();
	const byProject = new Map<string, Awaited<ReturnType<typeof listPluginRows>>>();
	for (const r of plugins) {
		if (!byProject.has(r.projectId)) byProject.set(r.projectId, await listPluginRows(r.projectId));
		const kind = pluginTriggerKind(r.type);
		const row = byProject
			.get(r.projectId)!
			.map(liveOf)
			.find((p) => kind.startsWith(`${p.name}/`));
		if (row && !row.devEnabled && !row.prodEnabled) disabled.add(r.id);
	}
	return disabled;
}
