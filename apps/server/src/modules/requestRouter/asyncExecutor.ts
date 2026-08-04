export const DEFAULT_ASYNC_MAX_IN_FLIGHT = 10;
export const DEFAULT_ASYNC_MAX_QUEUE_DEPTH = 100;
export const DEFAULT_ASYNC_DRAIN_TIMEOUT_MS = 30_000;

export type AsyncExecutorLimits = {
	maxInFlight: number;
	maxQueueDepth: number;
	drainTimeoutMs: number;
};

export type AsyncExecutorSnapshot = {
	inFlight: number;
	queued: number;
	accepting: boolean;
};

type QueuedTask = () => Promise<void>;

/**
 * Bounded, process-local execution queue for fire-and-forget route envelopes.
 *
 * It deliberately knows nothing about HTTP or a particular trigger. Future NATS,
 * Kafka, SQS, RabbitMQ and cron adapters can submit the same task shape, while a
 * distributed workflow runtime can replace this implementation at the boundary.
 */
export class AsyncExecutor {
	private readonly queue: QueuedTask[] = [];
	private readonly idleWaiters = new Set<() => void>();
	private inFlight = 0;
	private accepting = true;

	constructor(
		private readonly limits: AsyncExecutorLimits,
		private readonly onError: (error: unknown) => void,
	) {
		if (!Number.isInteger(limits.maxInFlight) || limits.maxInFlight < 1) {
			throw new Error("maxInFlight must be a positive integer");
		}
		if (!Number.isInteger(limits.maxQueueDepth) || limits.maxQueueDepth < 0) {
			throw new Error("maxQueueDepth must be a non-negative integer");
		}
	}

	/** Returns false instead of retaining more request bodies once capacity is full. */
	submit(task: QueuedTask): boolean {
		if (
			!this.accepting ||
			(this.inFlight >= this.limits.maxInFlight &&
				this.queue.length >= this.limits.maxQueueDepth)
		) {
			return false;
		}
		this.queue.push(task);
		this.pump();
		return true;
	}

	snapshot(): AsyncExecutorSnapshot {
		return {
			inFlight: this.inFlight,
			queued: this.queue.length,
			accepting: this.accepting,
		};
	}

	/** Stop new work and let accepted work complete during a graceful shutdown. */
	async drain(): Promise<boolean> {
		this.accepting = false;
		this.pump();
		if (this.isIdle()) return true;

		return new Promise<boolean>((resolve) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = (drained: boolean) => {
				if (timer) clearTimeout(timer);
				this.idleWaiters.delete(onIdle);
				resolve(drained);
			};
			const onIdle = () => finish(true);
			timer = setTimeout(() => finish(false), this.limits.drainTimeoutMs);
			this.idleWaiters.add(onIdle);
		});
	}

	private pump() {
		while (this.inFlight < this.limits.maxInFlight && this.queue.length > 0) {
			const task = this.queue.shift()!;
			this.inFlight++;
			queueMicrotask(async () => {
				try {
					await task();
				} catch (error) {
					this.onError(error);
				} finally {
					this.inFlight--;
					this.pump();
					this.notifyIdle();
				}
			});
		}
	}

	private isIdle() {
		return this.inFlight === 0 && this.queue.length === 0;
	}

	private notifyIdle() {
		if (!this.isIdle()) return;
		for (const resolve of this.idleWaiters) resolve();
		this.idleWaiters.clear();
	}
}

function readNonNegativeInt(value: string | undefined, fallback: number) {
	if (!value) return fallback;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Supervisor-owned environment configuration; passed into the secretless child. */
export function asyncExecutorLimitsFromEnv(
	env: Record<string, string | undefined> = process.env,
): AsyncExecutorLimits {
	return {
		maxInFlight: Math.max(
			1,
			readNonNegativeInt(env.ASYNC_EXECUTOR_MAX_IN_FLIGHT, DEFAULT_ASYNC_MAX_IN_FLIGHT),
		),
		maxQueueDepth: readNonNegativeInt(
			env.ASYNC_EXECUTOR_MAX_QUEUE_DEPTH,
			DEFAULT_ASYNC_MAX_QUEUE_DEPTH,
		),
		drainTimeoutMs: Math.max(
			1,
			readNonNegativeInt(
				env.ASYNC_EXECUTOR_DRAIN_TIMEOUT_MS,
				DEFAULT_ASYNC_DRAIN_TIMEOUT_MS,
			),
		),
	};
}
