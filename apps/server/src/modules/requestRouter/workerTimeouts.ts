export const WORKER_TIMEOUTS_ENABLED_KEY =
	"experimental.workerTimeouts.enabled" as const;

export function workerTimeoutsEnabled(
	settings: Record<string, string> | undefined,
) {
	return settings?.[WORKER_TIMEOUTS_ENABLED_KEY] === "true";
}
