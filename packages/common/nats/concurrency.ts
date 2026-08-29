/**
 * Counting semaphore. `release` hands the slot straight to the next waiter
 * rather than decrementing — decrementing first would let a fresh `acquire`
 * steal the slot before the waiter resumes, putting the pool over its limit.
 */
export interface Semaphore {
	acquire(): Promise<void>;
	release(): void;
	readonly active: number;
}

export function createSemaphore(limit: number): Semaphore {
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
			const next = waiting.shift();
			if (next) next();
			else active--;
		},
		get active() {
			return active;
		},
	};
}
