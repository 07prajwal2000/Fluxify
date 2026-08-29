/**
 * The NATS library: one place that knows about `@nats-io/*`, so the rest of the
 * stack talks to streams, buckets and subjects rather than to a client version.
 *
 * Pick by durability, not by convenience:
 * - `pubsub`  — at-most-once signals. A restarting process misses them.
 * - `queue`   — durable work. Delivered until acked, exactly one consumer.
 * - `kv`      — the current value of something, with replay on connect.
 * - `rpc`     — request/response, internal only.
 */

export * from "./codec";
export * from "./concurrency";
export * from "./connection";
export * from "./errors";
export * from "./kv";
export * from "./pubsub";
export * from "./queue";
export * from "./stream";
export * from "./types";
export * from "./rpc";
