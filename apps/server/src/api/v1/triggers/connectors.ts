import { BadRequestError } from "../../../errors/badRequestError";
import { resolveQueueConfig } from "../integrations/test-connection/service";
import { kafkaSourceSchema, natsSourceSchema, sqsSourceSchema } from "./dto";
import { findIntegration } from "./repository";

/** Each connector type's integration variant and source shape. */
const CONNECTORS = {
	kafka: { label: "Kafka", article: "A", schema: kafkaSourceSchema, invalid: "A Kafka trigger needs at least one topic" },
	nats: { label: "NATS", article: "A", schema: natsSourceSchema, invalid: "A NATS trigger needs a valid stream name" },
	sqs: { label: "SQS", article: "An", schema: sqsSourceSchema, invalid: "An SQS trigger needs a valid queue URL" },
} as const;

export type ConnectorCheck = {
	type: string;
	projectId: string;
	integrationId?: string | null;
	source?: unknown;
	batchSize?: number;
	/**
	 * Ask the broker whether the credentials work and the topic, stream or queue
	 * exists. On for creating, enabling, and edits to the source or integration.
	 */
	probe: boolean;
};

/**
 * A connector reads through an integration of its own kind, from this project,
 * and from something that exists. Caught here, it is a 400; left to the worker,
 * it is a trigger that is "on" and silently reads nothing.
 *
 * Returns warnings: settings that work but that the user should know about.
 */
export async function assertConnector(
	check: ConnectorCheck,
	tx?: Parameters<typeof findIntegration>[1],
): Promise<string[]> {
	const connector = CONNECTORS[check.type as keyof typeof CONNECTORS];
	if (!connector) return [];
	const { label, schema } = connector;
	if (!schema.safeParse(check.source).success) throw new BadRequestError(connector.invalid);
	const integration = check.integrationId ? await findIntegration(check.integrationId, tx) : undefined;
	if (
		!integration ||
		(integration.projectId ?? check.projectId) !== check.projectId ||
		integration.variant !== label
	)
		throw new BadRequestError(`${connector.article} ${label} trigger needs a ${label} integration from this project`);
	if (!check.probe) return settingsWarnings(check);

	const config = await resolveQueueConfig(check.projectId, integration.config as Record<string, unknown>);
	try {
		return await probe(check, config);
	} catch (error) {
		throw new BadRequestError(error instanceof Error ? error.message : String(error));
	}
}

async function probe(check: ConnectorCheck, config: any): Promise<string[]> {
	if (check.type === "nats") {
		const { assertNatsStream } = await import("@fluxify/adapters/queue/nats");
		await assertNatsStream(config, natsSourceSchema.parse(check.source).stream);
		return [];
	}
	if (check.type === "sqs") {
		const { assertSqsQueue, sqsWarnings } = await import("@fluxify/adapters/queue/sqs");
		const source = sqsSourceSchema.parse(check.source);
		return sqsWarnings({ ...source, batchSize: check.batchSize }, await assertSqsQueue(config, source.queueUrl));
	}
	const { topics, createTopics } = kafkaSourceSchema.parse(check.source);
	const { ensureKafkaTopics } = await import("@fluxify/adapters/queue/kafka");
	await ensureKafkaTopics(config, topics, Boolean(createTopics));
	return [];
}

/** The warnings that need no broker, for edits that leave the source alone. */
async function settingsWarnings(check: ConnectorCheck) {
	if (check.type !== "sqs") return [];
	const { sqsWarnings } = await import("@fluxify/adapters/queue/sqs");
	return sqsWarnings({ ...sqsSourceSchema.parse(check.source), batchSize: check.batchSize });
}
