import { createHash } from "node:crypto";
import type { RedisVariantConfig } from "../kv/redis";
import type { NatsConfig } from "../queue/nats";
import { SharedBroker, type SseBroker } from "./broker";
import { NatsWire } from "./nats";
import { RedisWire } from "./redis";

/** An integration's resolved config (`cfg:` references already expanded, as the queue and kv caches hold it). */
export type BrokerSource =
	| { kind: "nats"; config: NatsConfig }
	| { kind: "redis"; config: RedisVariantConfig };

type Entry = { fingerprint: string; broker: SseBroker };

/**
 * One broker per project and integration for the process, so every stream of a
 * project shares ONE subscriber connection. `brokerFor` opens nothing: the
 * connection opens on the first `subscribe` and closes with the last
 * unsubscribe, and a broker that went idle opens again on its next use.
 *
 * ponytail: the publishing connection stays open until `closeAll` or a config
 * change. Close it on idle if a worker ever hosts many mostly-idle projects.
 */
export class SseBrokerRegistry {
	private readonly brokers = new Map<string, Entry>();

	constructor(
		/** the integration's config, or undefined when it is gone or not `projectId`'s (#1019) */
		private readonly resolve: (
			integrationId: string,
			projectId: string,
		) => BrokerSource | undefined,
	) {}

	brokerFor(projectId: string, integrationId: string): SseBroker {
		const source = this.resolve(integrationId, projectId);
		if (!source) throw new Error("No SSE broker integration is selected, or it was deleted");
		const key = `${projectId}\0${integrationId}`;
		const fingerprint = createHash("sha256").update(JSON.stringify(source)).digest("hex");
		const existing = this.brokers.get(key);
		if (existing?.fingerprint === fingerprint) return existing.broker;
		// changed credentials: the old connections are closed, not left open with nothing able to reach them
		void existing?.broker.close().catch(() => undefined);
		const broker = new SharedBroker(
			source.kind === "nats" ? new NatsWire(source.config) : new RedisWire(source.config),
		);
		this.brokers.set(key, { fingerprint, broker });
		return broker;
	}

	/** Closes every broker. For shutdown and for tests. */
	async closeAll() {
		const entries = [...this.brokers.values()];
		this.brokers.clear();
		await Promise.all(entries.map((entry) => entry.broker.close().catch(() => undefined)));
	}
}
