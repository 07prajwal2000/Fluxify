/**
 * How many Trigger Workflow runs one project may have in flight at once.
 *
 * A long run, such as an AI agent, used to hold the only slot and make every
 * other user's run wait. Raising the limit lets runs overlap; the price is that
 * runs no longer start strictly in the order they were fired, which only a limit
 * of 1 keeps.
 */
export const TRIGGER_CONCURRENCY_KEY = "settings.workflows.triggerConcurrency";
export const DEFAULT_TRIGGER_CONCURRENCY = 10;
export const MIN_TRIGGER_CONCURRENCY = 1;
export const MAX_TRIGGER_CONCURRENCY = 100;

/** The saved setting, or the default when it is missing or not a whole number in range. */
export function triggerConcurrency(settings: Record<string, string> | undefined) {
	const raw = settings?.[TRIGGER_CONCURRENCY_KEY];
	// Number("") is 0, which would clamp an unset value to 1 instead of the default.
	const configured = raw ? Number(raw) : Number.NaN;
	if (!Number.isInteger(configured)) return DEFAULT_TRIGGER_CONCURRENCY;
	return Math.min(MAX_TRIGGER_CONCURRENCY, Math.max(MIN_TRIGGER_CONCURRENCY, configured));
}
