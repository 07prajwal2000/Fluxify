import type { HandleSpecs } from "@fluxify/blocks";
import type { DbTransactionType } from "../../db";
import { projectIdOf } from "../audit";
import { canvasPluginSpecs } from "../plugins/compile";
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
