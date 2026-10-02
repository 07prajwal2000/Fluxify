import { BLOCK_TYPES } from "../blocks/blockTypes";
import type { BlockData } from "../types";
import { isBlank } from "./dbConditionIssues";
import type { DiagnosticSeverity } from "./types";

/**
 * Checks for the blocks that talk to a KV store or a message queue, kept out
 * of `blockConfigValidator` so that file stays under the complexity cap.
 */

type Report = (severity: DiagnosticSeverity, message: string, tab?: string) => void;

export function kvIssues(type: string, data: BlockData, report: Report) {
	if (isBlank(data.connection))
		report("error", "No KV connection selected. Pick one in the General tab.", "General");
	if (type !== BLOCK_TYPES.kv_operations) return;
	if (isBlank(data.key))
		report("warning", "Key is empty. Enter it in the Operation tab.", "Operation");
	if (data.operation === "set" && data.useParam !== true && isBlank(data.value)) {
		report("warning", "Nothing to store. Enter a value or turn on Use Param.", "Operation");
	}
}

/** What a Send Message block is missing before it can run. */
export function sendMessageIssues(data: BlockData, report: Report) {
	if (isBlank(data.connection))
		report("error", "No message queue selected. Pick one in the General tab.", "General");
	if (data.mode === "raw") {
		if (isBlank(data.js)) report("warning", "No code to run. Write it in the Code tab.", "Code");
		return;
	}
	if (!isBlank(data.destination)) return;
	// a list's messages may each name their own destination
	if (data.bulk === true || data.useParam === true)
		report("warning", "No destination. Every message must then name its own.", "General");
	else report("error", "No destination. Enter it in the General tab.", "General");
}
