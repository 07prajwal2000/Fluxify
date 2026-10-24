import type { HandleSpecs } from "@fluxify/blocks";
import type { DbTransactionType } from "../../db";
import { ValidationError } from "../../errors/validationError";
import { projectIdOf } from "../audit";
import { canvasPluginEntries, canvasPluginSpecs } from "../plugins/compile";
import { integrationParamProblem, projectIntegration } from "../plugins/paramCheck";
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

/**
 * The plugin blocks a save writes: an `integration` param naming an integration
 * of this project takes it only when it is of the param's kind and `variants`,
 * and granted, the rule a plugin trigger's params follow. An id naming nothing
 * here is the runtime's error to report, as for built-in blocks.
 */
export async function assertPluginBlockParams(
	parent: CanvasParent,
	blocks: { id: string; type: string | null; data?: unknown }[],
	tx?: DbTransactionType,
) {
	const plugin = blocks.filter((b) => isPluginType(b.type));
	if (!plugin.length) return;
	const projectId = await projectIdOf(parentTable(parent.type), parent.id, tx)();
	const entries = await canvasPluginEntries(projectId, tx);
	const errors: { field: string; message: string }[] = [];
	for (const block of plugin) {
		const entry = entries[block.type!];
		if (!entry || !projectId) continue;
		const owner = { label: `block ${entry.name}`, granted: entry.permissions.integrations ?? [] };
		const data = (block.data ?? {}) as Record<string, unknown>;
		for (const [name, param] of Object.entries(entry.params)) {
			const value = data[name];
			if (param.type !== "integration" || typeof value !== "string" || !value) continue;
			const found = await projectIntegration(value, projectId, tx);
			const message = found && integrationParamProblem(owner, param, found);
			if (message) errors.push({ field: block.id, message: `${entry.label}: ${name}: ${message}` });
		}
	}
	if (errors.length) throw new ValidationError(errors);
}
