const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
export const DEFAULT_IDLE_TIMEOUT_MS = 7.5 * 60_000;

export type ResourceTimer = {
	setTimeout(handler: () => void, timeoutMs: number): unknown;
	clearTimeout(handle: unknown): void;
};

export type LeasedResourcesOptions = {
	drainTimeoutMs?: number;
	idleTimeoutMs?: number;
	timer?: ResourceTimer;
	/** a `destroy` that threw; the resource is dropped either way. Default: `console.error` */
	onCloseError?: (slot: string, error: unknown) => void;
};

/** How to make and unmake one resource; `idleMs` overrides the pool default, `0` never idle-closes. */
export type ResourceSpec<T> = {
	create(): T;
	destroy(value: T): unknown;
	idleMs?: number;
};

export type ResourceLease<T> = {
	value: T;
	release(): void;
	/** release, and drop the resource from the pool so the next acquire builds a fresh one */
	discard(): void;
};

const systemTimer: ResourceTimer = {
	setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type Entry<T> = {
	slot: string;
	fingerprint: string;
	value: T;
	spec: ResourceSpec<T>;
	leases: number;
	retired: boolean;
	drainTimer?: unknown;
	idleTimer?: unknown;
	closePromise?: Promise<void>;
};

/**
 * Keyed lazy resources with leases. A slot holds one live resource, built on
 * first acquire; a different fingerprint on the same slot swaps it, and the old
 * one closes once its leases drain (or after the drain timeout). A resource with
 * no leases closes after its idle time. `close()` closes everything.
 */
export class LeasedResources<T> {
	private readonly active = new Map<string, Entry<T>>();
	private readonly retiring = new Set<Entry<T>>();
	private readonly drainTimeoutMs: number;
	private readonly idleTimeoutMs: number;
	private readonly timer: ResourceTimer;
	private readonly onCloseError: (slot: string, error: unknown) => void;

	constructor(options: LeasedResourcesOptions = {}) {
		this.drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
		this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
		this.timer = options.timer ?? systemTimer;
		this.onCloseError =
			options.onCloseError ??
			((slot, error) => console.error(`Failed to close pooled resource ${slot}:`, error));
	}

	acquire(slot: string, fingerprint: string, spec: ResourceSpec<T>): ResourceLease<T> {
		let entry = this.active.get(slot);
		if (!entry || entry.fingerprint !== fingerprint) {
			entry = this.replace(slot, fingerprint, spec);
		}

		this.cancelIdleClose(entry);
		entry.leases += 1;
		const taken = entry;
		let released = false;
		const settle = (drop: boolean) => {
			if (released) return;
			released = true;
			taken.leases -= 1;
			if (drop && this.active.get(slot) === taken) {
				this.active.delete(slot);
				this.retire(taken);
				return;
			}
			if (taken.leases !== 0) return;
			if (taken.retired) void this.closeEntry(taken);
			else this.scheduleIdleClose(taken);
		};
		return { value: entry.value, release: () => settle(false), discard: () => settle(true) };
	}

	/** Builds the new resource first, so a failing create leaves the known-good one serving. */
	replace(slot: string, fingerprint: string, spec: ResourceSpec<T>) {
		const previous = this.active.get(slot);
		const entry: Entry<T> = {
			slot,
			fingerprint,
			value: spec.create(),
			spec,
			leases: 0,
			retired: false,
		};
		this.active.set(slot, entry);
		if (previous) this.retire(previous);
		return entry;
	}

	/** Takes `slot` out of service; it closes when its leases drain. */
	remove(slot: string) {
		const entry = this.active.get(slot);
		if (!entry) return;
		this.active.delete(slot);
		this.retire(entry);
	}

	/** `[slot, fingerprint]` of every live resource */
	fingerprints() {
		return [...this.active].map(([slot, entry]) => [slot, entry.fingerprint] as const);
	}

	async close() {
		const entries = [...this.active.values(), ...this.retiring];
		this.active.clear();
		this.retiring.clear();
		for (const entry of entries) {
			entry.retired = true;
			if (entry.drainTimer) this.timer.clearTimeout(entry.drainTimer);
			this.cancelIdleClose(entry);
		}
		await Promise.all(entries.map((entry) => this.closeEntry(entry)));
	}

	getStats() {
		return {
			active: this.active.size,
			retiring: this.retiring.size,
			leases: [...this.active.values(), ...this.retiring].reduce(
				(total, entry) => total + entry.leases,
				0,
			),
		};
	}

	private retire(entry: Entry<T>) {
		if (entry.retired) return;
		entry.retired = true;
		this.retiring.add(entry);
		if (entry.leases === 0) {
			void this.closeEntry(entry);
			return;
		}
		entry.drainTimer = this.timer.setTimeout(
			() => void this.closeEntry(entry),
			this.drainTimeoutMs,
		);
	}

	private scheduleIdleClose(entry: Entry<T>) {
		const idleMs = entry.spec.idleMs ?? this.idleTimeoutMs;
		if (idleMs <= 0 || entry.retired) return;
		this.cancelIdleClose(entry);
		entry.idleTimer = this.timer.setTimeout(() => {
			entry.idleTimer = undefined;
			if (entry.leases !== 0 || entry.retired) return;
			if (this.active.get(entry.slot) !== entry) return;
			this.active.delete(entry.slot);
			this.retire(entry);
		}, idleMs);
	}

	private cancelIdleClose(entry: Entry<T>) {
		if (entry.idleTimer) this.timer.clearTimeout(entry.idleTimer);
		entry.idleTimer = undefined;
	}

	private closeEntry(entry: Entry<T>) {
		if (entry.closePromise) return entry.closePromise;
		if (entry.drainTimer) this.timer.clearTimeout(entry.drainTimer);
		this.cancelIdleClose(entry);
		let destroyed: unknown;
		try {
			destroyed = entry.spec.destroy(entry.value);
		} catch (error) {
			destroyed = Promise.reject(error);
		}
		entry.closePromise = Promise.resolve(destroyed)
			.catch((error) => this.onCloseError(entry.slot, error))
			.then(() => {
				this.retiring.delete(entry);
			});
		return entry.closePromise;
	}
}
