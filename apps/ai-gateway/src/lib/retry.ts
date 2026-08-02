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
      
      const delay = Math.min(baseDelayMs * Math.pow(factor, attempt - 1), maxDelayMs);
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`[Retry] Operation failed (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`, { error: errorMessage });
      options.onRetry?.(attempt, maxRetries, error);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
