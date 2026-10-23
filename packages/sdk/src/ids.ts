import { MAX_BLOCK_ID_LENGTH, MAX_PROJECT_ID_LENGTH } from "./reserved.js";

/**
 * The id a worker's block library registers a plugin block under, and the id a
 * recorded span carries for the block that ran (#952):
 * `${plugin}@${version}:${projectId}:${type}`.
 */
export const customBlockId = (
	plugin: string,
	version: string,
	projectId: string,
	type: string,
): string => `${plugin}@${version}:${projectId}:${type}`;

/**
 * How long a block id can be in any project: the project id and the version are
 * budgeted at their maximum lengths, so this is the worst case.
 */
export const longestCustomBlockId = (plugin: string, version: string, type: string): number =>
	customBlockId(plugin, version, "x".repeat(MAX_PROJECT_ID_LENGTH), type).length;

/**
 * Why a plugin's longest block id would not fit a recorded span (#952), or
 * undefined when every block fits. The project id is budgeted at its maximum,
 * and the caller passes the version it will store, so this is the exact worst
 * case. The message names the block and how far over it is.
 */
export function blockIdProblem(
	plugin: string,
	version: string,
	types: readonly string[],
): string | undefined {
	let worst: { type: string; length: number } | undefined;
	for (const type of types) {
		const length = longestCustomBlockId(plugin, version, type);
		if (!worst || length > worst.length) worst = { type, length };
	}
	if (!worst || worst.length <= MAX_BLOCK_ID_LENGTH) return undefined;
	return `block '${worst.type}': its recorded block id can be ${worst.length} characters long (${plugin}@<version>:<project id>:${worst.type}, with the longest project id), which is ${worst.length - MAX_BLOCK_ID_LENGTH} over the ${MAX_BLOCK_ID_LENGTH}-character limit`;
}
