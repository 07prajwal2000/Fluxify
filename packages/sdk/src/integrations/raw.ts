// The drivers' own types, for `ctx.integrations.connection(...).raw`. Type-only, from
// optional peer dependencies: an author who installed a driver gets its real
// types; one who did not still compiles, and that `raw` is `unknown`. Each
// import is ts-ignored so a missing driver is no error under either skipLibCheck.
// biome-ignore-all lint/suspicious/noTsIgnore: a missing optional peer must not fail the author's build

// @ts-ignore optional peer
import type { SQS } from "@aws-sdk/client-sqs";
// @ts-ignore optional peer
import type { JetStreamClient } from "@nats-io/jetstream";
// @ts-ignore optional peer
import type { Producer } from "@platformatic/kafka";
// @ts-ignore optional peer
import type { ConfirmChannel } from "amqplib";
// @ts-ignore optional peer
import type { SQL } from "bun";
// @ts-ignore optional peer
import type { Redis } from "ioredis";
// @ts-ignore optional peer
import type Memcached from "memcached";
// @ts-ignore optional peer
import type { Db } from "mongodb";
// @ts-ignore optional peer
import type { Pool } from "mysql2";

/** a peer's type, or `unknown` when it is not installed (a failed import reads as `any`) */
type Peer<T> = unknown extends T ? unknown : T;

/**
 * Each built-in variant's own client, as `raw` hands it out: undefined where a
 * variant has no single client. Keyed by the variant's name, never an alias.
 */
export interface BuiltInVariantRaw {
	kv: {
		Redis: Peer<Redis>;
		Memcached: Peer<Memcached>;
	};
	/**
	 * The pool the adapter queries through. It is **not** the request's
	 * transaction: a query sent on it runs outside any transaction a Fluxify
	 * block started, and sees none of its uncommitted writes.
	 */
	database: {
		/** Bun's `SQL` */
		PostgreSQL: Peer<SQL>;
		/** mysql2's callback pool; `.promise()` for the promise API */
		MySQL: Peer<Pool>;
		/** the configured database */
		MongoDB: Peer<Db>;
	};
	queue: {
		Kafka: Peer<Producer<string, string, string, string>>;
		NATS: Peer<JetStreamClient>;
		SQS: Peer<SQS>;
		RabbitMQ: Peer<ConfirmChannel>;
	};
	/** the AI SDK models (`client.languageModel(...)`) are the client already */
	ai: {
		OpenAI: undefined;
		Anthropic: undefined;
		Gemini: undefined;
		Mistral: undefined;
		"OpenAI Compatible": undefined;
	};
	observability: { "Open Telemetry": undefined; Loki: undefined };
	mcp: { http: undefined };
	baas: Record<never, never>;
}
