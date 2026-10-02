import {
	DEFAULT_SEND_TIMEOUT_MS,
	errorText,
	type OutgoingMessage,
	type QueueProducerFactory,
	type SendOutcome,
} from "@fluxify/adapters";
import z from "zod";
import { baseBlockDataSchema, type Context } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import { type EmitNode, emitJsObject } from "../../compiler";

/** a text field the editor may have stored as a number */
const textValue = z.union([z.string(), z.number()]);

export const sendMessageBlockSchema = z
	.object({
		connection: z.string().describe("integration id: a Kafka, NATS, SQS or Redis integration"),
		mode: z
			.enum(["simple", "raw"])
			.default("simple")
			.describe("simple: the form fields; raw: js code with the broker's own client as `client`"),
		bulk: z
			.boolean()
			.default(false)
			.describe(
				"send a list: each item is a payload, or { payload, destination?, key?, headers?, ...options } to override the shared settings",
			),
		destination: textValue
			.default("")
			.describe(
				"topic (Kafka), subject (NATS), queue URL (SQS) or stream key (Redis); supports js expression",
			),
		useParam: z
			.boolean()
			.default(false)
			.describe(
				"use the previous block's output as the payload; a list is sent as one message per item and `bulk` is ignored",
			),
		payload: z
			.object({
				source: z.enum(["raw", "js"]).default("raw"),
				value: z.any().optional(),
			})
			.default({ source: "raw", value: {} })
			.describe(
				"raw: the value, js: code returning it. A string is sent as-is; anything else as JSON",
			),
		key: textValue.optional().describe("Kafka message key; supports js expression"),
		headers: z
			.record(z.string(), textValue)
			.optional()
			.describe("headers (Kafka, NATS) or message attributes (SQS); values support js expression"),
		options: z
			.record(z.string(), z.any())
			.optional()
			.describe(
				"broker options: Kafka partition, timestamp; NATS msgId; SQS delaySeconds, groupId, deduplicationId; Redis maxLen",
			),
		failWhen: z
			.enum(["all", "any"])
			.default("all")
			.describe(
				"bulk: take the failure branch when every message failed (all) or when any did (any)",
			),
		js: z
			.string()
			.default("")
			.describe("raw mode code; `client` is the broker client, whatever it returns is the output"),
	})
	.extend(baseBlockDataSchema.shape);

export type SendMessageBlockData = z.infer<typeof sendMessageBlockSchema>;

export const sendMessageAiDescription = {
	name: BlockTypes.queue_send,
	description:
		"Publishes one message or a list to a Kafka topic, NATS JetStream subject, SQS queue or Redis stream. Has success and failure branches.",
	jsonSchema: JSON.stringify(z.toJSONSchema(sendMessageBlockSchema)),
};

/** What the compiled code continues with: the success or the failure branch. */
type Branch = { result: unknown } | { failure: unknown };

type SendSpec = {
	bulk: boolean;
	failWhen: "all" | "any";
	payload: unknown;
	destination: unknown;
	key?: unknown;
	headers?: Record<string, unknown>;
	options?: Record<string, unknown>;
};

function factoryOf(context: Context): QueueProducerFactory {
	if (!context.queueFactory) throw new Error("Message queues are not available here");
	return context.queueFactory;
}

/** Without a failure branch the error goes to the error handler, like any block's. */
function fail(error: unknown, hasFailure: boolean): Branch {
	const message = errorText(error);
	if (hasFailure) return { failure: { error: message } };
	throw new Error(`failed to send message: ${message}`, { cause: error });
}

export async function runSendMessage(
	context: Context,
	connection: string,
	spec: SendSpec,
	hasFailure: boolean,
): Promise<Branch> {
	let items: unknown[];
	try {
		items = spec.bulk ? listOf(spec.payload) : [spec.payload];
	} catch (error) {
		return fail(error, hasFailure);
	}

	// a message that cannot be built fails alone, like one the broker refused
	const outcomes: SendOutcome[] = [];
	const messages: OutgoingMessage[] = [];
	const indexes: number[] = [];
	items.forEach((item, index) => {
		try {
			messages.push(toMessage(spec, item));
			indexes.push(index);
		} catch (error) {
			outcomes.push({ index, ok: false, error: errorText(error) });
		}
	});

	if (messages.length) {
		try {
			const factory = factoryOf(context);
			const producer = await factory.getProducer(connection);
			const timeoutMs =
				Number(factory.config(connection)?.sendTimeoutMs) || DEFAULT_SEND_TIMEOUT_MS;
			for (const outcome of await withTimeout(producer.send(messages), timeoutMs))
				outcomes.push({ ...outcome, index: indexes[outcome.index]! });
		} catch (error) {
			// the broker never answered: every message is unsent
			for (const index of indexes) outcomes.push({ index, ok: false, error: errorText(error) });
		}
	}
	outcomes.sort((a, b) => a.index - b.index);

	if (!spec.bulk) {
		const outcome = outcomes[0]!;
		return outcome.ok ? { result: outcome.result } : fail(outcome.error, hasFailure);
	}
	return settleBulk(outcomes, spec.failWhen, hasFailure);
}

function settleBulk(outcomes: SendOutcome[], failWhen: "all" | "any", hasFailure: boolean): Branch {
	const sent = [];
	const failed = [];
	for (const outcome of outcomes) {
		if (outcome.ok) sent.push({ index: outcome.index, ...outcome.result });
		else failed.push({ index: outcome.index, error: outcome.error });
	}
	const output = { sent, failed };
	const failing = failWhen === "any" ? failed.length > 0 : failed.length > 0 && sent.length === 0;
	if (!failing) return { result: output };
	if (hasFailure) return { failure: output };
	throw new Error(
		`failed to send message: ${failed.length} of ${outcomes.length} messages failed (first: ${failed[0]!.error})`,
	);
}

function listOf(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error("Bulk mode needs a list of messages");
	return value;
}

/** A bulk item carrying its own options, rather than being the payload itself. */
function isMessageItem(item: unknown): item is Record<string, unknown> & { payload: unknown } {
	return (
		typeof item === "object" &&
		item !== null &&
		!Array.isArray(item) &&
		Object.hasOwn(item, "payload")
	);
}

function toMessage(spec: SendSpec, item: unknown): OutgoingMessage {
	const own = spec.bulk && isMessageItem(item) ? item : undefined;
	const fields: Record<string, unknown> = own ?? { payload: item };
	const { payload, destination, key, headers, ...options } = fields;
	const target = text(destination) ?? text(spec.destination);
	if (!target) throw new Error("No destination: set the topic, subject, queue URL or stream");
	const merged = { ...spec.headers, ...(headers as Record<string, unknown> | undefined) };
	const headerEntries = Object.entries(merged)
		.map(([name, value]) => [name, text(value)] as const)
		.filter((entry): entry is readonly [string, string] => entry[1] !== undefined);
	const messageKey = text(key) ?? text(spec.key);
	return {
		destination: target,
		payload,
		...(messageKey === undefined ? {} : { key: messageKey }),
		...(headerEntries.length ? { headers: Object.fromEntries(headerEntries) } : {}),
		options: { ...spec.options, ...options },
	};
}

/** A setting as text; blank is unset. Objects become JSON, like a payload. */
function text(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value === "string") return value.trim() || undefined;
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new Error(
						`No answer from the broker in ${ms} ms. The message may still have been delivered.`,
					),
				),
			ms,
		);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * `client` is published on vars for the duration of the snippet and deleted
 * after, the same way the KV raw block publishes `kv`. The client is shared by
 * every run, so it is handed over guarded: user code cannot close it.
 */
export async function runSendMessageRaw(
	context: Context,
	connection: string,
	hasFailure: boolean,
	body: () => Promise<unknown>,
): Promise<Branch> {
	const vars = context.vars as Record<string, any>;
	try {
		const producer = await factoryOf(context).getProducer(connection);
		vars.client = guardClient(await producer.client());
		return { result: await body() };
	} catch (error) {
		return fail(error, hasFailure);
	} finally {
		delete vars.client;
	}
}

const CLOSERS = new Set(["close", "disconnect", "destroy", "drain", "quit", "end"]);
const guarded = new WeakMap<object, object>();

function hasCloser(value: object) {
	return [...CLOSERS].some(
		(name) => typeof (value as Record<string, unknown>)[name] === "function",
	);
}

/**
 * The client with every close-like method refused. A connection reached through
 * a property (NATS `client.nc`) is guarded the same way. Methods are bound to
 * the real client, so clients with private fields still work.
 */
export function guardClient<T>(client: T): T {
	if (typeof client !== "object" || client === null) return client;
	let proxy = guarded.get(client);
	if (!proxy) {
		proxy = new Proxy(client, {
			get(target, property) {
				if (typeof property === "string" && CLOSERS.has(property))
					return () => {
						throw new Error(
							`${property}() is not allowed: Fluxify manages this connection and reuses it across runs`,
						);
					};
				const value = Reflect.get(target, property, target);
				if (typeof value === "function") return value.bind(target);
				return typeof value === "object" && value !== null && hasCloser(value)
					? guardClient(value)
					: value;
			},
		});
		guarded.set(client, proxy);
	}
	return proxy as T;
}

function emitPayload(input: SendMessageBlockData, node: EmitNode) {
	if (input.useParam) return node.in;
	const { source, value } = input.payload;
	if (source === "js" && typeof value === "string") {
		return node.js(value.startsWith("js:") ? value.slice(3) : value, node.in);
	}
	return emitJsObject(value, node);
}

/** With the input as payload, the input decides: a list is one message per item. */
function emitBulk(input: SendMessageBlockData, node: EmitNode) {
	return input.useParam ? `Array.isArray(${node.in})` : String(input.bulk);
}

export function emitSendMessage(node: EmitNode) {
	const input = sendMessageBlockSchema.parse(node.block.data);
	const sent = node.v("sent");
	const hasFailure = node.has("failure");
	const call =
		input.mode === "raw"
			? `lib.sendMessageRaw(ctx, ${node.value(input.connection)}, ${hasFailure}, async () => ${node.js(input.js.startsWith("js:") ? input.js.slice(3) : input.js, node.in)})`
			: `lib.sendMessage(ctx, ${node.value(input.connection)}, { bulk: ${emitBulk(input, node)}, failWhen: ${JSON.stringify(input.failWhen)}, payload: ${emitPayload(input, node)}, destination: ${node.value(input.destination)}, key: ${node.value(input.key)}, headers: ${emitJsObject(input.headers ?? {}, node)}, options: ${emitJsObject(input.options ?? {}, node)} }, ${hasFailure})`;
	return `const ${sent} = await ${call};
if ("failure" in ${sent}) {
${node.in} = ${sent}.failure;
${node.next("failure")}
}
${node.in} = ${sent}.result;
${node.next("success")}`;
}
