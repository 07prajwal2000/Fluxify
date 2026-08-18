import { BlockTypes, getOutputHandles } from "@fluxify/blocks";
import type { ValidatableBlock } from "./schemas";

const SINGLETON_TYPES = [BlockTypes.entrypoint, BlockTypes.errorHandler];

/**
 * The runtime resolves an edge with `findEdge(block, handle)`, which takes the
 * first match and drops the rest — so two edges on one handle is a silently
 * halved workflow, not a parallel branch. It also never asks for a handle a
 * block type does not have, so an edge on an invented handle is simply never
 * traversed. Neither shows up as an error at apply time; both show up as a
 * route that quietly does less than the user asked for.
 */
export function validateGraphRules(blocks: ValidatableBlock[]): string[] {
	const errors: string[] = [];
	const seenIds = new Set<string>();
	const singletonCounts = new Map<string, string[]>();

	for (const block of blocks) {
		if (!block?.id) continue;

		if (seenIds.has(block.id)) {
			errors.push(
				`Block "${block.id}" is defined more than once. Each block must appear exactly once, either in "blocks" or in a "block_change", never both.`,
			);
			continue;
		}
		seenIds.add(block.id);

		const rawType = block.blockType || "";
		if (SINGLETON_TYPES.includes(rawType as BlockTypes)) {
			singletonCounts.set(rawType, [
				...(singletonCounts.get(rawType) ?? []),
				block.id,
			]);
		}

		const isCustom =
			rawType.startsWith("custom:") ||
			!Object.values(BlockTypes).includes(rawType as BlockTypes);
		// custom blocks are a plain pass-through: one `source` handle
		const allowed = isCustom ? ["source"] : getOutputHandles(rawType);
		const usedHandles = new Map<string, string[]>();

		for (const conn of block.connections ?? []) {
			if (!conn?.blockId) continue;
			const handle = conn.handle || "source";

			if (!allowed.includes(handle)) {
				errors.push(
					allowed.length === 0
						? `Block "${block.id}" of type "${rawType}" is a terminal block and has no output handles, but it connects to "${conn.blockId}". Remove the connection.`
						: `Block "${block.id}" of type "${rawType}" has no "${handle}" handle. Its only output handle(s): ${allowed.map((h) => `"${h}"`).join(", ")}.`,
				);
				continue;
			}

			usedHandles.set(handle, [
				...(usedHandles.get(handle) ?? []),
				conn.blockId,
			]);
		}

		for (const [handle, targets] of usedHandles) {
			if (targets.length > 1) {
				errors.push(
					`Block "${block.id}" fans out: its "${handle}" handle connects to ${targets.length} blocks (${targets.map((t) => `"${t}"`).join(", ")}). The runtime follows only the first and silently drops the rest. Each handle must have at most ONE outgoing connection — chain the blocks in sequence instead, or use an "if" block whose "success"/"failure" handles are the branches.`,
				);
			}
		}
	}

	for (const [type, ids] of singletonCounts) {
		if (ids.length > 1) {
			errors.push(
				`A canvas may contain exactly one "${type}" block, but ${ids.length} were provided (${ids.map((i) => `"${i}"`).join(", ")}). Keep one and remove the rest.`,
			);
		}
	}

	return errors;
}
