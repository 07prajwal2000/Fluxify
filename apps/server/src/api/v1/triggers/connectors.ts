import { BadRequestError } from "../../../errors/badRequestError";
import { missingIntegrationMessage, pickValue } from "../../../lib/envValues";
import * as testConnectionService from "../integrations/test-connection/service";
import {
	kafkaSourceSchema,
	natsSourceSchema,
	rabbitMqSourceSchema,
	redisSourceSchema,
	sqsSourceSchema,
} from "./dto";
import * as triggerRepo from "./repository";

/** Each connector type's integration variant and source shape. */
const CONNECTORS = {
	kafka: {
		label: "Kafka",
		article: "A",
		schema: kafkaSourceSchema,
		invalid: "A Kafka trigger needs at least one topic",
	},
	nats: {
		label: "NATS",
		article: "A",
		schema: natsSourceSchema,
		invalid: "A NATS trigger needs a valid stream name",
	},
	sqs: {
		label: "SQS",
		article: "An",
		schema: sqsSourceSchema,
		invalid: "An SQS trigger needs a valid queue URL",
	},
	// a KV integration; Memcached has no streams, so only the Redis variant passes
	redis: {
		label: "Redis",
		article: "A",
		schema: redisSourceSchema,
		invalid: "A Redis trigger needs a valid stream key",
	},
	rabbitmq: {
		label: "RabbitMQ",
		article: "A",
		schema: rabbitMqSourceSchema,
		invalid: "A RabbitMQ trigger needs a queue name",
	},
} as const;

export type ConnectorCheck = {
	type: string;
	projectId: string;
	integrationId?: string | null;
	source?: unknown;
	batchSize?: number;
	concurrency?: number;
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
export const connectorProbers = {
	nats: async (config: any, stream: string) => {
		const { assertNatsStream } = await import("@fluxify/adapters/queue/nats");
		await assertNatsStream(config, stream);
	},
	redis: async (config: any, stream: string) => {
		const { assertRedisStream } = await import("@fluxify/adapters/queue/redis");
		await assertRedisStream(config, stream);
	},
	sqs: async (config: any, queueUrl: string) => {
		const { assertSqsQueue } = await import("@fluxify/adapters/queue/sqs");
		return await assertSqsQueue(config, queueUrl);
	},
	rabbitmq: async (config: any, queue: string) => {
		const { assertRabbitMqQueue } = await import("@fluxify/adapters/queue/rabbitmq");
		await assertRabbitMqQueue(config, queue);
	},
	kafka: async (config: any, topics: string[], createTopics: boolean) => {
		const { ensureKafkaTopics } = await import("@fluxify/adapters/queue/kafka");
		await ensureKafkaTopics(config, topics, createTopics);
	},
};

export async function assertConnector(
	check: ConnectorCheck,
	tx?: Parameters<typeof triggerRepo.findIntegration>[1],
): Promise<string[]> {
	const connector = CONNECTORS[check.type as keyof typeof CONNECTORS];
	if (!connector) return [];
	const { label, schema } = connector;
	if (!schema.safeParse(check.source).success) throw new BadRequestError(connector.invalid);
	const integration = check.integrationId
		? await triggerRepo.findIntegration(check.integrationId, tx)
		: undefined;
	if (
		!integration ||
		(integration.projectId ?? check.projectId) !== check.projectId ||
		integration.variant !== label
	)
		throw new BadRequestError(
			`${connector.article} ${label} trigger needs a ${label} integration from this project`,
		);
	if (!check.probe) return settingsWarnings(check);

	// the development credentials an admin-side connection uses (#733): saving a trigger
	// probes the development broker. When development has no value, skip the probe and warn.
	const rawConfig = pickValue(
		"development",
		integration.syncDev,
		integration.config,
		integration.devConfig,
	);
	if (!rawConfig) {
		const base = await settingsWarnings(check);
		return [...base, `${missingIntegrationMessage(integration.name)}: skipped probe`];
	}

	const config = await testConnectionService.resolveQueueConfig(
		check.projectId,
		rawConfig as Record<string, unknown>,
		"development",
	);
	try {
		return await probe(check, config);
	} catch (error) {
		throw new BadRequestError(error instanceof Error ? error.message : String(error));
	}
}

async function probe(check: ConnectorCheck, config: any): Promise<string[]> {
	if (check.type === "nats") {
		await connectorProbers.nats(config, natsSourceSchema.parse(check.source).stream);
		return [];
	}
	if (check.type === "redis") {
		await connectorProbers.redis(config, redisSourceSchema.parse(check.source).stream);
		return [];
	}
	if (check.type === "sqs") {
		const { sqsWarnings } = await import("@fluxify/adapters/queue/sqs");
		const source = sqsSourceSchema.parse(check.source);
		return sqsWarnings(
			{ ...source, batchSize: check.batchSize },
			await connectorProbers.sqs(config, source.queueUrl),
		);
	}
	if (check.type === "rabbitmq") {
		await connectorProbers.rabbitmq(config, rabbitMqSourceSchema.parse(check.source).queue);
		return settingsWarnings(check);
	}
	const { topics, createTopics } = kafkaSourceSchema.parse(check.source);
	await connectorProbers.kafka(config, topics, Boolean(createTopics));
	return [];
}

/** The warnings that need no broker, for edits that leave the source alone. */
async function settingsWarnings(check: ConnectorCheck) {
	if (check.type === "rabbitmq") {
		const { rabbitMqWarnings } = await import("@fluxify/adapters/queue/rabbitmq");
		return rabbitMqWarnings(check);
	}
	if (check.type !== "sqs") return [];
	const { sqsWarnings } = await import("@fluxify/adapters/queue/sqs");
	return sqsWarnings({ ...sqsSourceSchema.parse(check.source), batchSize: check.batchSize });
}
