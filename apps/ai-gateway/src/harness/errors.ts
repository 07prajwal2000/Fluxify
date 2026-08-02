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

/**
 * Turns a raw error message into a human-readable explanation, shared by the
 * terminal failure report (`describeFailure`) and the live retry-warning
 * events (`HarnessCallbacks.emitRetryWarning`) — both need the same
 * categorization, just with different framing around it.
 */
export function explainErrorReason(raw: string): string {
	const lower = raw.toLowerCase();

	// Order matters: the two cases below both mention JSON, but they call for
	// completely different action, so they must be matched before the generic
	// structured-output branch.
	if (lower.includes("empty response")) {
		return "the AI model returned nothing at all — it most likely spent its whole output budget on reasoning. Try a model with a larger output limit, or one that does not reason as heavily.";
	}
	if (
		lower.includes("json parse error") ||
		lower.includes("unexpected identifier") ||
		lower.includes("unexpected token") ||
		lower.includes("unexpected eof")
	) {
		return "the AI model replied in plain prose instead of JSON. Models behind an OpenAI-compatible endpoint often ignore the JSON output format — the harness re-asks and usually recovers, but a model with reliable JSON support will be faster.";
	}
	if (
		lower.includes("structured output") ||
		lower.includes("json") ||
		lower.includes("schema")
	) {
		return "the AI model did not return a valid, complete response in the required format. This usually means the model ran out of output space or is not reliable at structured output — try a larger or stronger model, or split the request into smaller steps.";
	}
	if (
		lower.includes("rate limit") ||
		lower.includes("429") ||
		lower.includes("quota")
	) {
		return "the AI provider rejected the request due to rate limits or exhausted quota. Please wait a moment and try again, or check your provider plan.";
	}
	if (
		lower.includes("401") ||
		lower.includes("403") ||
		lower.includes("unauthorized") ||
		lower.includes("api key")
	) {
		return "the AI provider rejected the credentials for this integration. Please check the API key and model configured for this project.";
	}
	if (
		lower.includes("context length") ||
		lower.includes("too many tokens") ||
		lower.includes("maximum context")
	) {
		return "the request grew larger than the model's context window. Try a model with a bigger context window, or a narrower request.";
	}
	if (
		lower.includes("timeout") ||
		lower.includes("timed out") ||
		lower.includes("etimedout") ||
		lower.includes("econnreset") ||
		lower.includes("socket") ||
		lower.includes("fetch failed") ||
		lower.includes("network")
	) {
		return "the AI provider took too long to respond or could not be reached. This request involved a lot of back-and-forth with the model — try again, or use a faster model.";
	}
	return "an unexpected error occurred while processing this request.";
}
