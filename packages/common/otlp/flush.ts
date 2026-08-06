/** anything holding a BatchSpanProcessor or PeriodicExportingMetricReader */
type Flushable = { forceFlush(): Promise<void>; shutdown(): Promise<void> };

/**
 * Bun emits `close` on an outgoing http request even when it succeeded, and
 * `otlp-exporter-base` treats that event as a timeout
 * (`http-transport-utils.js:84`). The telemetry still arrives — verified against
 * a live Jaeger — so this is a spurious failure, not a lost export.
 *
 * It has to be swallowed somewhere: a caller that believed it would log an error
 * on every successful flush. `tracing/instrumentation.ts:110` already swallows
 * the same string for the global provider.
 */
/**
 * `BasicTracerProvider.forceFlush` aggregates its processors' failures and
 * rejects with an **array** of errors, not an error — so unwrap before matching,
 * or the guard silently never fires.
 */
function isBunFlushQuirk(error: unknown): boolean {
	const errors = Array.isArray(error) ? error : [error];
	return (
		errors.length > 0 &&
		errors.every(
			(entry) => entry instanceof Error && /request timed out/i.test(entry.message),
		)
	);
}

export async function flushTelemetry(provider: Flushable): Promise<void> {
	try {
		await provider.forceFlush();
	} catch (error) {
		if (!isBunFlushQuirk(error)) throw error;
	}
}

/** `shutdown` flushes first, so it hits the same quirk. */
export async function shutdownTelemetry(provider: Flushable): Promise<void> {
	try {
		await provider.shutdown();
	} catch (error) {
		if (!isBunFlushQuirk(error)) throw error;
	}
}
