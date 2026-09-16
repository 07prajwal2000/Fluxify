import { sortByOrder } from "@fluxify/blocks/layout";
import { blockLabels } from "../blocks/blockLabels";
import { BLOCK_TYPES } from "../blocks/blockTypes";
import type { CanvasGraph } from "../types";
import type { BlockDiagnostic } from "./types";

export const SWITCH_SOURCE = "switch-cases";
export const NO_DEFAULT =
	"This Switch has no default case. If no case matches, the flow stops here and returns the Switch's input. To handle that, drag a case into the Default slot in the Cases tab.";

/** a missing, blank, or empty `js:` entry picks nothing at run time */
function isBlank(raw: unknown) {
	const text = typeof raw === "string" ? raw.trim() : "";
	return !(text.startsWith("js:") ? text.slice(3).trim() : text);
}

/** edges persist the handle as `<blockId>-case`; older/agent-built ones may say just `case` */
const isCaseEdge = (blockId: string, handle: string) =>
	handle === "case" || handle === `${blockId}-case`;

/**
 * Warns about switch blocks that can never pick a case: nothing wired to the
 * Cases handle, a case with no condition (or match value), or value mode with
 * an empty value script.
 */
export function validateSwitches(graph: CanvasGraph): BlockDiagnostic[] {
	const diagnostics: BlockDiagnostic[] = [];
	const byId = new Map(graph.blocks.map((b) => [b.id, b]));
	const warn = (blockId: string, message: string) =>
		diagnostics.push({ blockId, severity: "warning", message, source: SWITCH_SOURCE });

	for (const block of graph.blocks) {
		if (block.type !== BLOCK_TYPES.switch) continue;
		const data = block.data ?? {};
		const cases = sortByOrder(
			graph.edges.filter((e) => e.from === block.id && isCaseEdge(block.id, e.fromHandle)),
			Array.isArray(data.order) ? (data.order as string[]) : [],
			(e) => e.to,
		);

		if (cases.length === 0) {
			warn(
				block.id,
				"This Switch has no cases connected, so the flow always stops here. Connect a block to the Cases handle on the right for each path you need.",
			);
			continue;
		}

		const useValue = data.useValue === true;
		if (useValue && isBlank(data.value)) {
			warn(
				block.id,
				'"Switch on a value" is turned on but the value script is empty, so no case can ever match. In the General tab, write a script that returns the value to compare, e.g. return input.status;',
			);
		}
		if (!cases.some((edge) => edge.to === data.defaultCase)) {
			warn(block.id, NO_DEFAULT);
		}
		const entries = (data[useValue ? "matches" : "conditions"] ?? {}) as Record<string, unknown>;
		// the default case has no condition to check
		cases.filter((edge) => edge.to !== data.defaultCase).forEach((edge, index) => {
			const target = byId.get(edge.to);
			const label = `Case ${index + 1} (${target ? blockLabels(target.type, target.data).name : edge.to})`;
			const raw = entries[edge.to];
			if (isBlank(raw)) {
				warn(
					block.id,
					useValue
						? `${label} has no match value, so it never runs. In the Cases tab, enter the value the value script returns for this path, e.g. paid`
						: `${label} has no condition, so it never runs. In the Cases tab, turn on JS and return true when this path should run, e.g. js: return input.status === "paid";`,
				);
			}
		});
	}

	return diagnostics;
}
