import type { BlockData } from "../types";
import { whole } from "./transactionValidator";
import type { DiagnosticSeverity } from "./types";

/** mirrors MAX_RETRY_WAIT_MS in @fluxify/blocks; the root barrel is server-only */
const MAX_RETRY_WAIT_MS = 30_000;

/** the retry's own settings, checked the way the server's save does */
export function checkRetrySettings(
	data: BlockData,
	report: (severity: DiagnosticSeverity, message: string, tab?: string) => void,
) {
	if (!whole(data.maxRetries, 1, 10)) {
		report("error", "Max retries must be a whole number from 1 to 10.", "General");
	}
	if (!whole(data.delayMs, 0, MAX_RETRY_WAIT_MS) || !whole(data.maxDelayMs, 0, MAX_RETRY_WAIT_MS)) {
		report(
			"error",
			`Delay and max delay must be whole numbers from 0 to ${MAX_RETRY_WAIT_MS} ms.`,
			"Delay",
		);
	}
}

const UNWIRED: Record<string, string> = {
	executor: "Nothing is connected to the executor handle, so there is nothing to retry.",
	success: "Nothing is connected to the success handle, so the run ends after a try that works.",
	failure:
		"Nothing is connected to the failure handle, so when every try fails the last error fails the run.",
};

/** a warning per Retry handle with no edge; edges store the handle as `<blockId>-<kind>` */
export function unwiredRetryHandles(
	blockId: string,
	edges: { from: string; fromHandle: string }[],
) {
	return Object.keys(UNWIRED)
		.filter((kind) => !edges.some((e) => e.from === blockId && e.fromHandle.endsWith(kind)))
		.map((kind) => UNWIRED[kind]);
}
