/**
 * The contract every external queue a trigger consumes from implements.
 *
 * A connection lives in the execution process next to the workflow it feeds,
 * so a batch goes from the broker to user code with no internal hop. The
 * helpers here are the portable subset; `raw()` is the escape hatch for
 * anything the connector's own client can do and the contract does not cover.
 */

/** One message, with where it came from. */
export type QueueEvent = {
	data: unknown;
	topic: string;
	partition: number;
	/** broker offsets outgrow a JS number, so they stay strings */
	offset: string;
	key: string | null;
	headers: Record<string, string>;
	timestamp: string;
};

/** One unit of work handed to a workflow run. */
export type QueueBatch = {
	events: QueueEvent[];
	consumerGroup: string;
	/** the partition's latest offset when the batch was read, if the broker says */
	highWatermark: string | null;
	/** 1 on first delivery, counting up on each retry of the same batch */
	attempt: number;
};

export type QueueSubscription = {
	/** what to read, in the connector's own terms, e.g. Kafka's `topics` */
	source: Record<string, unknown>;
	consumerGroup: string;
	batchSize: number;
	maxWaitMs: number;
	maxBytes: number;
	/** batches in flight at once, e.g. partitions consumed concurrently */
	concurrency: number;
	/** first backoff before the broker redelivers, for connectors that own their retries */
	retryDelayMs?: number;
	/** the source was deleted under a running consumer; the connection has already stopped */
	onSourceGone?: (error: QueueSourceGoneError) => void;
};

/** The topic, stream or queue no longer exists: retrying cannot help, the trigger must be disabled. */
export class QueueSourceGoneError extends Error {
	override readonly name = "QueueSourceGoneError";
}

/**
 * Settles when the batch is done with. A throw means it was not: nothing is
 * committed and the connector must deliver it again. The connection is the one
 * that read the batch, so a commit never lands on a consumer that replaced it.
 */
export type QueueHandler = (batch: QueueBatch, connection: QueueConnection) => Promise<void>;

export abstract class QueueConnection {
	/**
	 * The broker counts deliveries and dead-letters on its own (SQS redrive).
	 * Each delivery is then one run: a failure is thrown back for the broker to
	 * redeliver, never retried in process or moved by us.
	 */
	readonly deadLettersNatively: boolean = false;
	/** Starts delivering batches to `handler`. Resolves once consuming has begun. */
	abstract consume(subscription: QueueSubscription, handler: QueueHandler): Promise<void>;
	/** Marks everything up to and including this batch as processed. */
	abstract commit(batch: QueueBatch): Promise<void>;
	/** Parks a batch that cannot succeed where it will not be redelivered. */
	abstract moveToDLQ(batch: QueueBatch, error: unknown): Promise<void>;
	/** Messages waiting behind the committed offset, or null if unknown. */
	abstract lag(): Promise<number | null>;
	/** Stops consuming and waits for in-flight batches to settle. */
	abstract stop(): Promise<void>;
	/** The connector's own client, for anything the helpers do not cover. */
	abstract raw(): unknown;
}

/** JSON when it parses, the text when it does not, null when empty. */
export function decode(data: Uint8Array) {
	if (data.length === 0) return null;
	const text = new TextDecoder().decode(data);
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** What a connector module exports; loaded only when a trigger needs it. */
export type QueueConnector = {
	createConnection(config: unknown): QueueConnection;
};
