import { createHash } from "node:crypto";
import type { QueueConnector, QueueProducer } from "./base";
import { loadQueueConnector } from "./manager";

/** Integration variant -> the connector that publishes for it. */
const CONNECTOR_BY_VARIANT: Record<string, string> = {
	Kafka: "kafka",
	NATS: "nats",
	SQS: "sqs",
	// a Redis KV integration publishes to streams
	Redis: "redis",
};

/** Waits for a broker's answer this long when the integration sets no `sendTimeoutMs`. */
export const DEFAULT_SEND_TIMEOUT_MS = 30_000;

type Entry = { fingerprint: string; producer: Promise<QueueProducer> };

function fingerprintOf(config: unknown) {
	return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

/**
 * Resolves an integration to its producer for the Send Message block, one per
 * integration per process, reused across runs like `KvFactory`'s clients.
 *
 * Queue integrations come from the queue cache; a Redis KV integration publishes
 * to streams. That one gets its own client rather than the KV block's, so a
 * credential change closes both the same way.
 *
 * ponytail: producers live until their config changes or the process exits, so
 * an idle integration holds one connection open. Add idle-close if a worker
 * ever hosts many mostly-idle queue integrations.
 */
export class QueueProducerFactory {
	private static readonly producers = new Map<string, Entry>();

	constructor(
		private readonly queueConfigs: Record<string, any>,
		private readonly kvConfigs: Record<string, any> = {},
		/** whether the caller may use an integration; the caches hold every project's */
		private readonly owns: (config: Record<string, any>) => boolean = () => true,
		private readonly load: (type: string) => Promise<QueueConnector> = loadQueueConnector,
	) {}

	/** The integration's config, or undefined when it is no message queue the caller owns. */
	config(connection: string): Record<string, any> | undefined {
		const queue = this.queueConfigs[connection];
		const kv = this.kvConfigs[connection];
		const config = queue ?? (kv?.variant === "Redis" ? kv : undefined);
		return config && this.owns(config) ? config : undefined;
	}

	getProducer(connection: string): Promise<QueueProducer> {
		const config = this.config(connection);
		if (!config) throw new Error("No message queue integration is selected, or it was deleted");
		const type = CONNECTOR_BY_VARIANT[config.variant];
		if (!type) throw new Error(`${config.variant} cannot send messages`);

		const fingerprint = fingerprintOf(config);
		const existing = QueueProducerFactory.producers.get(connection);
		if (existing?.fingerprint === fingerprint) return existing.producer;
		if (existing) void QueueProducerFactory.evict(connection);

		const producer = this.load(type).then((connector) => {
			if (!connector.createProducer) throw new Error(`${config.variant} cannot send messages`);
			return connector.createProducer(config);
		});
		QueueProducerFactory.producers.set(connection, { fingerprint, producer });
		// a connector that failed to load is not cached: the next run tries again
		producer.catch(() => {
			if (QueueProducerFactory.producers.get(connection)?.producer === producer)
				QueueProducerFactory.producers.delete(connection);
		});
		return producer;
	}

	/** A producer whose integration changed or is gone is closed and dropped. */
	static synchronize(queueConfigs: Record<string, any>, kvConfigs: Record<string, any> = {}) {
		const current = new QueueProducerFactory(queueConfigs, kvConfigs);
		for (const [connection, entry] of QueueProducerFactory.producers) {
			const config = current.config(connection);
			if (!config || fingerprintOf(config) !== entry.fingerprint)
				void QueueProducerFactory.evict(connection);
		}
	}

	/** Closes every producer. For shutdown and for tests. */
	static async closeAll() {
		await Promise.all(
			[...QueueProducerFactory.producers.keys()].map((connection) =>
				QueueProducerFactory.evict(connection),
			),
		);
	}

	private static async evict(connection: string) {
		const entry = QueueProducerFactory.producers.get(connection);
		if (!entry) return;
		// dropped first: a failing close must not leave a dead producer cached
		QueueProducerFactory.producers.delete(connection);
		try {
			await (await entry.producer).close();
		} catch {
			// a producer that will not close cleanly is still gone from the map
		}
	}
}
