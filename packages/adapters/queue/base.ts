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
	topics: string[];
	consumerGroup: string;
	batchSize: number;
	maxWaitMs: number;
	maxBytes: number;
	/** batches in flight at once, e.g. partitions consumed concurrently */
	concurrency: number;
};

/** Settles when the batch is done with; a throw means it failed. */
export type QueueHandler = (batch: QueueBatch) => Promise<void>;

export abstract class QueueConnection {
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

/** What a connector module exports; loaded only when a trigger needs it. */
export type QueueConnector = {
	createConnection(config: unknown): QueueConnection;
};
