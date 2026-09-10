import { createHash } from "node:crypto";
import type { QueueConnection, QueueConnector, QueueHandler, QueueSubscription } from "./base";

/**
 * Connectors by trigger type. A loader is a dynamic `import()`, so a process
 * with no Kafka trigger never loads the Kafka client.
 */
const connectors = new Map<string, () => Promise<QueueConnector>>();

export function registerQueueConnector(type: string, load: () => Promise<QueueConnector>) {
	connectors.set(type, load);
}

export async function loadQueueConnector(type: string): Promise<QueueConnector> {
	const load = connectors.get(type);
	if (!load) throw new Error(`No queue connector registered for "${type}"`);
	return load();
}

/** Everything that decides what a trigger's consumer connects to and reads. */
export type QueueTriggerSpec = {
	type: string;
	config: unknown;
	subscription: QueueSubscription;
};

type Running = { type: string; fingerprint: string; connection: QueueConnection };
type Loaded = { connector: Promise<QueueConnector>; users: number };

/**
 * Owns the queue consumers of one execution process, one per trigger.
 *
 * Starting a trigger whose spec is unchanged is a no-op; a changed spec (new
 * credentials, topics, batch settings) stops the old consumer, draining its
 * in-flight batches, before the new one starts. Operations on one trigger run
 * in order, so a start racing a stop cannot leave a consumer behind.
 */
export class QueueConnectionManager {
	private readonly running = new Map<string, Running>();
	private readonly queued = new Map<string, Promise<void>>();
	private readonly loaded = new Map<string, Loaded>();

	constructor(private readonly load: (type: string) => Promise<QueueConnector> = loadQueueConnector) {}

	start(triggerId: string, spec: QueueTriggerSpec, handler: QueueHandler) {
		return this.inOrder(triggerId, () => this.apply(triggerId, spec, handler));
	}

	stop(triggerId: string) {
		return this.inOrder(triggerId, () => this.retire(triggerId));
	}

	has(triggerId: string) {
		return this.running.has(triggerId);
	}

	connection(triggerId: string) {
		return this.running.get(triggerId)?.connection;
	}

	async close() {
		await Promise.allSettled([...this.queued.values()]);
		await Promise.all([...this.running.keys()].map((triggerId) => this.stop(triggerId)));
	}

	getStats() {
		return { running: this.running.size, connectors: [...this.loaded.keys()] };
	}

	private async apply(triggerId: string, spec: QueueTriggerSpec, handler: QueueHandler) {
		const fingerprint = queueFingerprint(spec);
		if (this.running.get(triggerId)?.fingerprint === fingerprint) return;
		// Stop before starting: two consumers of one trigger in one process would
		// only split its partitions between themselves.
		await this.retire(triggerId);

		const connector = await this.acquire(spec.type);
		let connection: QueueConnection | undefined;
		try {
			connection = connector.createConnection(spec.config);
			await connection.consume(spec.subscription, handler);
		} catch (error) {
			await connection?.stop().catch(() => undefined);
			this.release(spec.type);
			throw error;
		}
		this.running.set(triggerId, { type: spec.type, fingerprint, connection });
	}

	private async retire(triggerId: string) {
		const entry = this.running.get(triggerId);
		if (!entry) return;
		this.running.delete(triggerId);
		try {
			await entry.connection.stop();
		} finally {
			this.release(entry.type);
		}
	}

	private async acquire(type: string) {
		let entry = this.loaded.get(type);
		if (!entry) {
			entry = { connector: this.load(type), users: 0 };
			this.loaded.set(type, entry);
		}
		entry.users += 1;
		try {
			return await entry.connector;
		} catch (error) {
			this.release(type);
			throw error;
		}
	}

	/** Drops the connector with its last trigger so its client can be collected. */
	private release(type: string) {
		const entry = this.loaded.get(type);
		if (!entry) return;
		entry.users -= 1;
		if (entry.users <= 0) this.loaded.delete(type);
	}

	private inOrder(triggerId: string, operation: () => Promise<void>) {
		const previous = this.queued.get(triggerId) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(operation);
		this.queued.set(triggerId, next);
		void next
			.catch(() => undefined)
			.finally(() => {
				if (this.queued.get(triggerId) === next) this.queued.delete(triggerId);
			});
		return next;
	}
}

/** Hashes the spec; credentials inside `config` are never retained or logged. */
export function queueFingerprint(spec: QueueTriggerSpec) {
	return createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}
