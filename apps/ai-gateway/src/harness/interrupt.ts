import { logger } from "@fluxify/common";
import { publishMessage, subscribeToChannel } from "@fluxify/server";

/* ============================================================================
 * RUN INTERRUPT DELIVERY
 * ----------------------------------------------------------------------------
 * A run executes in the worker thread; the interrupt request arrives on the API
 * (main thread). BullMQ can't message a running job, so the request is delivered
 * over NATS: the API publishes `harness.interrupt.<conversationId>`, the worker
 * subscribes and aborts the matching run's AbortController.
 * ========================================================================== */

const INTERRUPT_SUBJECT_PREFIX = "harness.interrupt";
const INTERRUPT_WILDCARD = `${INTERRUPT_SUBJECT_PREFIX}.*`;

function interruptSubject(conversationId: string): string {
	return `${INTERRUPT_SUBJECT_PREFIX}.${conversationId}`;
}

/** conversationId -> AbortController for runs executing in THIS worker process. */
const activeControllers = new Map<string, AbortController>();

export function registerRunController(
	conversationId: string,
	controller: AbortController,
): void {
	activeControllers.set(conversationId, controller);
}

export function unregisterRunController(conversationId: string): void {
	activeControllers.delete(conversationId);
}

/** Aborts a run executing in this process. Returns true if one was running. */
export function abortLocalRun(conversationId: string): boolean {
	const controller = activeControllers.get(conversationId);
	if (!controller) return false;
	controller.abort();
	return true;
}

/** API side: request an interrupt of the given conversation's active run. */
export function requestInterrupt(conversationId: string): void {
	publishMessage(interruptSubject(conversationId), conversationId);
}

/** Worker side: listen for interrupt requests and abort the matching local run.
 *  Call once at worker startup. Returns an async unsubscribe. */
export async function subscribeInterrupts(): Promise<() => Promise<void>> {
	const unsubscribe = await subscribeToChannel(
		INTERRUPT_WILDCARD,
		(conversationId) => {
			const aborted = abortLocalRun(conversationId);
			logger.info("[HarnessInterrupt] Interrupt request received", {
				conversationId,
				aborted,
			});
		},
	);
	logger.info("Subscribed to harness.interrupt.*", "HarnessInterrupt");
	return unsubscribe;
}
