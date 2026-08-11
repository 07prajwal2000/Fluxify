import { logger } from "@fluxify/common";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  /** When aborted, the operation is not retried — the error propagates at once. */
  signal?: AbortSignal;
  /** Called right before each retry sleep — lets a caller surface the retry
   *  (e.g. as a live event) without changing the retry/backoff behavior. */
  onRetry?: (attempt: number, maxRetries: number, error: unknown) => void;
}

/**
 * Rate limits are quota windows, not blips: a provider's per-minute token bucket
 * refills in seconds, so the 0.5s/1s ladder just burns both retries inside the
 * same window and fails the run. Honour `retry-after` when the provider sends
 * one, otherwise climb 5s → 10s → 20s, capped at a minute.
 */
const RATE_LIMIT_BASE_MS = 5000;
const RATE_LIMIT_MAX_MS = 60000;

export function rateLimitDelayMs(error: unknown, attempt = 1): number | null {
  const status = (error as { statusCode?: number; status?: number })?.statusCode
    ?? (error as { status?: number })?.status;
  if (status !== 429) return null;
  const headers = (error as { headers?: Headers | Record<string, string> })?.headers;
  const retryAfter =
    headers instanceof Headers
      ? headers.get("retry-after")
      : (headers as Record<string, string> | undefined)?.["retry-after"];
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0)
    return Math.min(seconds * 1000, RATE_LIMIT_MAX_MS);
  return Math.min(
    RATE_LIMIT_BASE_MS * Math.pow(2, Math.max(attempt, 1) - 1),
    RATE_LIMIT_MAX_MS,
  );
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 500,
    maxDelayMs = 10000,
    factor = 2,
  } = options;

  let attempt = 0;
  
  while (true) {
    try {
      return await operation();
    } catch (error) {
      // A user interrupt / abort must never be retried — propagate immediately.
      // Nor a blown run budget: retrying only spends more of what ran out.
      if (
        options.signal?.aborted ||
        (error instanceof Error &&
          (error.name === "UserInterruptError" ||
            error.name === "AbortError" ||
            error.name === "RunBudgetExceededError"))
      ) {
        throw error;
      }
      attempt++;
      if (attempt > maxRetries) {
        logger.error(`[Retry] Operation failed after ${maxRetries} retries.`, { error });
        throw error;
      }
      
      const delay =
        rateLimitDelayMs(error, attempt) ??
        Math.min(baseDelayMs * Math.pow(factor, attempt - 1), maxDelayMs);
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`[Retry] Operation failed (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`, { error: errorMessage });
      options.onRetry?.(attempt, maxRetries, error);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
