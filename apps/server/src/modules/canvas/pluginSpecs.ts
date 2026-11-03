import type { HandleSpecs } from "@fluxify/blocks";
import {
	activeParams,
	isJsExpression,
	type ManifestEntry,
	paramProblems,
} from "@fluxify/sdk/blocks";
import type { DbTransactionType } from "../../db";
import { ValidationError } from "../../errors/validationError";
import { projectIdOf } from "../audit";
import { canvasPluginEntries, canvasPluginSpecs } from "../plugins/compile";
import { integrationValueProblem } from "../plugins/paramCheck";
import { parentTable } from "./repository";
import type { CanvasParent } from "./types";

/** plugin types are `scope/name/.../block`; built-in and custom block names have no `/` */
const isPluginType = (type: string | null) => !!type?.includes("/");

/** every plugin block this canvas's project may hold (#857), by type */
export const parentPluginSpecs = async (parent: CanvasParent, tx?: DbTransactionType) =>
	canvasPluginSpecs(await projectIdOf(parentTable(parent.type), parent.id, tx)(), tx);

/**
 * `parentPluginSpecs` for the types given. Read once, and only when one of them is a plugin type, so a
 * canvas without plugin blocks costs no query.
 */
export function pluginSpecsOf(parent: CanvasParent, tx?: DbTransactionType) {
	let specs: Promise<HandleSpecs> | undefined;
	return async (types: Iterable<string | null>): Promise<HandleSpecs> => {
		if (![...types].some(isPluginType)) return {};
		specs ??= parentPluginSpecs(parent, tx);
		return specs;
	};
}

type FieldError = { field: string; message: string };

/**
 * One plugin block's params as it will be stored: the rules `prepareParams`
 * would fail the run by (`paramProblems`: required, type, select, bounds, list
 * and row rules; a `js:` value and a hidden param are skipped), and an
 * `integration` param naming an integration of this project takes it only when
 * it is of the param's kind and `variants`, and granted, the rule a plugin
 * trigger's params follow. An id naming nothing in this project is refused,
 * unless `unknownOk` (an import).
 */
async function blockParamErrors(
	block: { id: string; data?: unknown },
	entry: ManifestEntry,
	projectId: string,
	tx?: DbTransactionType,
	unknownOk = false,
) {
	const owner = { label: `block ${entry.name}`, granted: entry.permissions.integrations ?? [] };
	const data = (block.data ?? {}) as Record<string, unknown>;
	const problems = paramProblems(entry.params, data);
	const errors: FieldError[] = [];
	for (const name of activeParams(entry.params, data).names) {
		const param = entry.params[name]!;
		const value = data[name];
		const checked =
			param.type === "integration" && typeof value === "string" && value && !isJsExpression(value);
		const problem =
			problems[name] ??
			(checked
				? await integrationValueProblem(owner, param, value, projectId, tx, unknownOk)
				: undefined);
		if (problem) errors.push({ field: block.id, message: `${entry.label}: ${name}: ${problem}` });
	}
	return errors;
}

/**
 * The plugin blocks a save writes must hold params the runtime would take (see
 * `blockParamErrors`); every bad block is reported at once. `data` is the whole
 * block, a save replaces it.
 */
export async function assertPluginBlockParams(
	parent: CanvasParent,
	blocks: { id: string; type: string | null; data?: unknown }[],
	tx?: DbTransactionType,
	unknownOk = false,
) {
	const plugin = blocks.filter((b) => isPluginType(b.type));
	if (!plugin.length) return;
	const projectId = await projectIdOf(parentTable(parent.type), parent.id, tx)();
	const entries = await canvasPluginEntries(projectId, tx);
	const errors: FieldError[] = [];
	for (const block of plugin) {
		const entry = entries[block.type!];
		if (entry && projectId)
			errors.push(...(await blockParamErrors(block, entry, projectId, tx, unknownOk)));
	}
	if (errors.length) throw new ValidationError(errors);
}
