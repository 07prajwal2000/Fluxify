/**
 * Type-level verification for built-in adapter contracts.
 * Compiled by `tsgo --noEmit` (`bun run typecheck`), never executed at runtime.
 */
import type {
	AiAdapter,
	DatabaseAdapter,
	IntrospectedTable,
	KvAdapter,
	McpAdapter,
	ObservabilityAdapter,
	QueueConnection,
	QueueConnector,
	QueueProducer,
	SchemaDetails,
} from "@fluxify/sdk/integrations";
import {
	type AnthropicIntegration,
	type BaseAiIntegration,
	type BaseKVIntegration,
	createObservabilityLogger,
	describeConnection,
	describeMongo,
	describeSql,
	type GeminiIntegration,
	introspectConnection,
	type LokiLogger,
	type MemcachedIntegration,
	type MistralIntegration,
	type MongoAdapter,
	type MySqlAdapter,
	type OpenAICompatibleIntegration,
	type OpenAIIntegration,
	type OpenTelemetryLogs,
	openMcpClient,
	type PostgresAdapter,
	type RedisIntegration,
} from "./index";
import { type KafkaConnection, createConnection as kafkaCreateConnection } from "./queue/kafka";
import { type KafkaProducer, createProducer as kafkaCreateProducer } from "./queue/kafkaProducer";
import { type NatsQueueConnection, createConnection as natsCreateConnection } from "./queue/nats";
import { type NatsProducer, createProducer as natsCreateProducer } from "./queue/natsProducer";
import {
	type RabbitMqConnection,
	createConnection as rabbitmqCreateConnection,
} from "./queue/rabbitmq";
import {
	type RabbitMqProducer,
	createProducer as rabbitmqCreateProducer,
} from "./queue/rabbitmqProducer";
import {
	type RedisStreamsConnection,
	createConnection as redisStreamsCreateConnection,
} from "./queue/redisStreams";
import {
	type RedisStreamsProducer,
	createProducer as redisStreamsCreateProducer,
} from "./queue/redisStreamsProducer";
import { type SqsQueueConnection, createConnection as sqsCreateConnection } from "./queue/sqs";
import { type SqsProducer, createProducer as sqsCreateProducer } from "./queue/sqsProducer";

// ---------------------------------------------------------------------------
// 1. Positive checks: Built-in adapters satisfy SDK contracts
// ---------------------------------------------------------------------------

function _typecheckPositive() {
	// Database
	const _pg: DatabaseAdapter = null as unknown as PostgresAdapter;
	const _mysql: DatabaseAdapter = null as unknown as MySqlAdapter;
	const _mongo: DatabaseAdapter = null as unknown as MongoAdapter;

	// Describe & Introspect
	const _descSql: Promise<SchemaDetails> = describeSql("postgres", async () => []);
	const _descMongo: Promise<SchemaDetails> = describeMongo(null as never);
	const _descConn: Promise<SchemaDetails> = describeConnection(null as never);
	const _introConn: Promise<IntrospectedTable[]> = introspectConnection(null as never);

	// Key-Value
	const _kvBase: KvAdapter = null as unknown as BaseKVIntegration;
	const _kvRedis: KvAdapter = null as unknown as RedisIntegration;
	const _kvMemcached: KvAdapter = null as unknown as MemcachedIntegration;

	// Observability
	const _obsLoki: ObservabilityAdapter = null as unknown as LokiLogger;
	const _obsOtel: ObservabilityAdapter = null as unknown as OpenTelemetryLogs;
	const _obsCreated: ObservabilityAdapter = createObservabilityLogger("Loki", {});

	// AI
	const _aiBase: AiAdapter = null as unknown as BaseAiIntegration;
	const _aiOpenAi: AiAdapter = null as unknown as OpenAIIntegration;
	const _aiAnthropic: AiAdapter = null as unknown as AnthropicIntegration;
	const _aiGemini: AiAdapter = null as unknown as GeminiIntegration;
	const _aiMistral: AiAdapter = null as unknown as MistralIntegration;
	const _aiOpenAiCompat: AiAdapter = null as unknown as OpenAICompatibleIntegration;

	// Queue Consumers
	const _qKafka: QueueConnection = null as unknown as KafkaConnection;
	const _qNats: QueueConnection = null as unknown as NatsQueueConnection;
	const _qSqs: QueueConnection = null as unknown as SqsQueueConnection;
	const _qRabbit: QueueConnection = null as unknown as RabbitMqConnection;
	const _qRedis: QueueConnection = null as unknown as RedisStreamsConnection;

	// Queue Producers
	const _qpKafka: QueueProducer = null as unknown as KafkaProducer;
	const _qpNats: QueueProducer = null as unknown as NatsProducer;
	const _qpSqs: QueueProducer = null as unknown as SqsProducer;
	const _qpRabbit: QueueProducer = null as unknown as RabbitMqProducer;
	const _qpRedis: QueueProducer = null as unknown as RedisStreamsProducer;

	// Queue Connectors
	const _qcKafka: QueueConnector = {
		createConnection: kafkaCreateConnection,
		createProducer: kafkaCreateProducer,
	};
	const _qcNats: QueueConnector = {
		createConnection: natsCreateConnection,
		createProducer: natsCreateProducer,
	};
	const _qcSqs: QueueConnector = {
		createConnection: sqsCreateConnection,
		createProducer: sqsCreateProducer,
	};
	const _qcRabbit: QueueConnector = {
		createConnection: rabbitmqCreateConnection,
		createProducer: rabbitmqCreateProducer,
	};
	const _qcRedis: QueueConnector = {
		createConnection: redisStreamsCreateConnection,
		createProducer: redisStreamsCreateProducer,
	};

	// MCP Client
	const _mcpClientPromise: Promise<McpAdapter> = openMcpClient({ url: "http://localhost:3000" });

	void [
		_pg,
		_mysql,
		_mongo,
		_descSql,
		_descMongo,
		_descConn,
		_introConn,
		_kvBase,
		_kvRedis,
		_kvMemcached,
		_obsLoki,
		_obsOtel,
		_obsCreated,
		_aiBase,
		_aiOpenAi,
		_aiAnthropic,
		_aiGemini,
		_aiMistral,
		_aiOpenAiCompat,
		_qKafka,
		_qNats,
		_qSqs,
		_qRabbit,
		_qRedis,
		_qpKafka,
		_qpNats,
		_qpSqs,
		_qpRabbit,
		_qpRedis,
		_qcKafka,
		_qcNats,
		_qcSqs,
		_qcRabbit,
		_qcRedis,
		_mcpClientPromise,
	];
}

// ---------------------------------------------------------------------------
// 2. Negative checks: Incomplete objects fail to satisfy contracts
// ---------------------------------------------------------------------------

function _typecheckNegative() {
	// @ts-expect-error Incomplete DatabaseAdapter
	const _badDb: DatabaseAdapter = {
		getAll: async () => [],
	};

	// @ts-expect-error Incomplete KvAdapter
	const _badKv: KvAdapter = {
		get: async () => null,
	};

	// @ts-expect-error Incomplete ObservabilityAdapter
	const _badObs: ObservabilityAdapter = {
		logInfo: () => {},
	};

	// @ts-expect-error Incomplete AiAdapter (missing languageModel)
	const _badAi: AiAdapter = {
		embeddingModel: () => null as never,
	};

	// @ts-expect-error Incomplete QueueConnection
	const _badQueueConn: QueueConnection = {
		deadLettersNatively: false,
	};

	// @ts-expect-error Incomplete QueueProducer
	const _badQueueProd: QueueProducer = {
		close: async () => {},
	};

	// @ts-expect-error Incomplete QueueConnector (missing createConnection)
	const _badQueueConnector: QueueConnector = {
		createProducer: () => null as never,
	};

	// @ts-expect-error Incomplete McpAdapter
	const _badMcp: McpAdapter = {
		listTools: async () => [],
	};

	void [_badDb, _badKv, _badObs, _badAi, _badQueueConn, _badQueueProd, _badQueueConnector, _badMcp];
}

void [_typecheckPositive, _typecheckNegative];
