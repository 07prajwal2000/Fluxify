import { blockDefinition, type BlockDefinition } from "./blockCatalog";
import type { BlockData } from "../types";

/**
 * The server fills these in for every block when nothing was typed, so they are
 * placeholders rather than real names — fall back to the catalog instead.
 */
const PLACEHOLDERS = new Set(["Name", "Description"]);

function text(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed && !PLACEHOLDERS.has(trimmed) ? trimmed : undefined;
}

export type BlockLabels = {
	/** What the block calls itself, or the catalog name. */
	name: string;
	description: string;
	/** Catalog entry behind the labels (name, category, sockets). */
	definition: BlockDefinition;
	/** True when the name came from the block's own data. */
	custom: boolean;
};

/**
 * Resolves what a block should be called: its own `blockName`/`blockDescription`
 * when set, otherwise the catalog's. `label`/`description` are also read so a
 * caller can drive a node without knowing the server's field names.
 */
export function blockLabels(type: string, data?: BlockData): BlockLabels {
	const definition = blockDefinition(type);
	const name = text(data?.blockName) ?? text(data?.label);
	const description = text(data?.blockDescription) ?? text(data?.description);

	return {
		name: name ?? definition.name,
		description: description ?? definition.description,
		definition,
		custom: name !== undefined,
	};
}
