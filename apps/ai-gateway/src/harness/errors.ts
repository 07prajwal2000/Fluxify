/**
 * Thrown when a user interrupts a running harness graph. Propagates out of the
 * AI model layer (via the run's AbortSignal), is NOT retried by the retry
 * wrapper, and is caught by the top-level graph try/catch so the run can be
 * finalized as `interrupted` cleanly (DB + socket) instead of `failed`.
 */
export class UserInterruptError extends Error {
	constructor(message = "Run was stopped by the user") {
		super(message);
		this.name = "UserInterruptError";
	}
}

/** True for a user interrupt or the underlying AbortSignal abort it triggers. */
export function isUserInterrupt(error: unknown): boolean {
	if (error instanceof UserInterruptError) return true;
	return error instanceof Error && error.name === "AbortError";
}
