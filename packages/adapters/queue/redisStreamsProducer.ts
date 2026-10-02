import type { Redis } from "ioredis";
import { createRedisClient, type RedisVariantConfig } from "../kv/redis";
import {
	encodePayload,
	errorText,
	type OutgoingMessage,
	QueueProducer,
	type SendOutcome,
} from "./base";

/**
 * Appends to Redis streams for the Send Message block, over a KV integration's
 * credentials. A stream entry is named fields, not one body: an object payload's
 * keys become the fields, anything else goes in one `data` field. Values are
 * text, as the Redis Streams trigger hands them back.
 */
export class RedisStreamsProducer extends QueueProducer {
	private readonly redis: Redis;

	constructor(config: RedisVariantConfig) {
		super();
		this.redis = createRedisClient(config);
		// failures surface on the commands; ioredis would otherwise print each reconnect error
		this.redis.on("error", () => undefined);
	}

	async send(messages: OutgoingMessage[]) {
		const outcomes: SendOutcome[] = [];
		const pipeline = this.redis.pipeline();
		const queued: number[] = [];
		messages.forEach((message, index) => {
			try {
				const args = [...trim(message.options?.maxLen), "*", ...streamFields(message.payload)];
				pipeline.xadd(message.destination, ...(args as ["*", ...string[]]));
				queued.push(index);
			} catch (error) {
				outcomes.push({ index, ok: false, error: errorText(error) });
			}
		});
		const replies = queued.length ? ((await pipeline.exec()) ?? []) : [];
		queued.forEach((index, i) => {
			const [error, id] = replies[i] ?? [new Error("No reply from Redis")];
			outcomes.push(
				error
					? { index, ok: false, error: errorText(error) }
					: { index, ok: true, result: { stream: messages[index]!.destination, id } },
			);
		});
		return outcomes.sort((a, b) => a.index - b.index);
	}

	async client() {
		return this.redis;
	}

	async close() {
		await this.redis.quit();
	}
}

/** `MAXLEN ~ n` keeps the stream near `n` entries; blank leaves it unbounded. */
function trim(maxLen: unknown): string[] {
	if (maxLen === undefined || maxLen === null || maxLen === "") return [];
	const n = Number(maxLen);
	if (!Number.isInteger(n) || n < 1)
		throw new Error(`maxLen must be a whole number of 1 or more, got ${String(maxLen)}`);
	return ["MAXLEN", "~", String(n)];
}

/** An object's keys as `[name, value, ...]`, each value as message text. */
export function streamFields(payload: unknown): string[] {
	const isRecord = typeof payload === "object" && payload !== null && !Array.isArray(payload);
	const entries = isRecord ? Object.entries(payload) : [["data", payload] as const];
	const fields = entries
		.filter(([, value]) => value !== undefined)
		.flatMap(([name, value]) => [name, encodePayload(value)]);
	if (fields.length === 0) throw new Error("A stream entry needs at least one field");
	return fields;
}

export function createProducer(config: unknown) {
	return new RedisStreamsProducer(config as RedisVariantConfig);
}
