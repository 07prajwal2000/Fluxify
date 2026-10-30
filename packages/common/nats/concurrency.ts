/**
 * Counting semaphore. `release` hands the slot straight to the next waiter
 * rather than decrementing — decrementing first would let a fresh `acquire`
 * steal the slot before the waiter resumes, putting the pool over its limit.
 *
 * The limit can change while slots are held. Raising it wakes waiters at once;
 * lowering it never interrupts work, it only stops handing slots on until the
 * holders have drained below the new limit.
 */
export interface Semaphore {
	acquire(): Promise<void>;
	release(): void;
	resize(limit: number): void;
	readonly active: number;
}

export function createSemaphore(initialLimit: number): Semaphore {
	let limit = initialLimit;
	let active = 0;
	const waiting: Array<() => void> = [];

	return {
		async acquire(): Promise<void> {
			if (active < limit) {
				active++;
				return;
			}
			await new Promise<void>((resolve) => waiting.push(resolve));
		},
		release(): void {
			// Over the limit after a shrink: give the slot back instead of passing it on.
			if (active > limit) {
				active--;
				return;
			}
			const next = waiting.shift();
			if (next) next();
			else active--;
		},
		resize(next: number): void {
			limit = next;
			while (active < limit && waiting.length > 0) {
				active++;
				waiting.shift()?.();
			}
		},
		get active() {
			return active;
		},
	};
}
