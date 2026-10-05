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
