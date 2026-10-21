// Type tests for SDK integration contracts: compiled by `bun run typecheck`, never run.
import type {
	AiAdapter,
	AiInspectResult,
	BaasAdapter,
	BaasInspectResult,
	BuiltInIntegrationAdapters,
	BuiltInIntegrationInspectResults,
	DatabaseAdapter,
	IntegrationGroup,
	IntegrationVariantDef,
	IntegrationVariantMeta,
	KvAdapter,
	KvInspectResult,
	McpAdapter,
	McpInspectResult,
	McpTool,
	ObservabilityAdapter,
	ObservabilityInspectResult,
	QueueConnection,
	QueueConnector,
	QueueInspectResult,
	QueueProducer,
	SchemaDetails,
} from "../integrations.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
	? true
	: false;
const assert = <T extends true>() => {};

function contractTypeChecks() {
	// Verify group mapping completeness
	assert<Equal<keyof BuiltInIntegrationAdapters, IntegrationGroup>>();
	assert<Equal<keyof BuiltInIntegrationInspectResults, IntegrationGroup>>();

	// Positive shape validation for mock implementations
	const mockDb: DatabaseAdapter = {
		getAll: async () => [],
		getPage: async () => ({ rows: [], nextCursor: null }),
		getSingle: async () => null,
		count: async () => 0,
		insert: async () => ({}),
		insertBulk: async () => [],
		update: async () => ({ count: 0, affected: [] }),
		raw: async () => ({}),
		delete: async () => ({ count: 0, affected: [] }),
		setMode: async () => {},
		startTransaction: async () => {},
		commitTransaction: async () => {},
		rollbackTransaction: async () => {},
	};

	const mockKv: KvAdapter = {
		get: async () => null,
		set: async () => {},
		setex: async () => {},
		delete: async () => {},
	};

	const mockAi: AiAdapter = {
		createModel: () => ({}),
	};

	const mockObs: ObservabilityAdapter = {
		logInfo: () => {},
		logWarn: () => {},
		logError: () => {},
	};

	const mockBaas: BaasAdapter = {
		client: () => ({}),
	};

	const mockMcp: McpAdapter = {
		listTools: async (): Promise<McpTool[]> => [],
		callTool: async () => ({}),
		close: () => {},
	};

	const mockQueueProd: QueueProducer = {
		send: async () => [],
		client: async () => ({}),
		close: async () => {},
	};

	const mockQueueConn: QueueConnection = {
		deadLettersNatively: false,
		consume: async () => {},
		commit: async () => {},
		moveToDLQ: async () => {},
		lag: async () => 0,
		stop: async () => {},
		raw: () => ({}),
	};

	const mockQueueConnector: QueueConnector = {
		createConnection: () => mockQueueConn,
		createProducer: () => mockQueueProd,
	};

	// Inspect shapes
	const mockDbInspect: SchemaDetails = { tables: ["users"] };
	const mockKvInspect: KvInspectResult = { keys: ["k1"] };
	const mockQueueInspect: QueueInspectResult = { topics: ["t1"] };
	const mockAiInspect: AiInspectResult = { models: ["m1"] };
	const mockObsInspect: ObservabilityInspectResult = { signals: ["logs"] };
	const mockBaasInspect: BaasInspectResult = { services: ["auth"] };
	const mockMcpInspect: McpInspectResult = { tools: [{ name: "calc" }] };

	void [
		mockDb,
		mockKv,
		mockAi,
		mockObs,
		mockBaas,
		mockMcp,
		mockQueueProd,
		mockQueueConn,
		mockQueueConnector,
		mockDbInspect,
		mockKvInspect,
		mockQueueInspect,
		mockAiInspect,
		mockObsInspect,
		mockBaasInspect,
		mockMcpInspect,
	];

	// Negative checks: incomplete implementations
	// @ts-expect-error missing methods on DatabaseAdapter
	const _incompleteDb: DatabaseAdapter = {
		getAll: async () => [],
	};

	// @ts-expect-error missing methods on KvAdapter
	const _incompleteKv: KvAdapter = {
		get: async () => null,
	};

	// @ts-expect-error missing createModel on AiAdapter
	const _incompleteAi: AiAdapter = {};

	// @ts-expect-error missing log methods on ObservabilityAdapter
	const _incompleteObs: ObservabilityAdapter = {};

	// @ts-expect-error missing client on BaasAdapter
	const _incompleteBaas: BaasAdapter = {};

	// @ts-expect-error missing methods on McpAdapter
	const _incompleteMcp: McpAdapter = {};

	// @ts-expect-error missing methods on QueueProducer
	const _incompleteQueueProd: QueueProducer = {};

	// @ts-expect-error missing methods on QueueConnection
	const _incompleteQueueConn: QueueConnection = {};

	// @ts-expect-error missing createConnection on QueueConnector
	const _incompleteQueueConnector: QueueConnector = {};

	void [
		_incompleteDb,
		_incompleteKv,
		_incompleteAi,
		_incompleteObs,
		_incompleteBaas,
		_incompleteMcp,
		_incompleteQueueProd,
		_incompleteQueueConn,
		_incompleteQueueConnector,
	];
}

void contractTypeChecks;

// Registry definitions (#902): a database variant, built-in or plugin, has to
// declare its condition editor, and a database def its pool and adapter hooks.
function variantTypeChecks() {
	const configSchema = {} as IntegrationVariantMeta["configSchema"];
	const meta = { variant: "X", label: "X", configSchema };
	const extras = { conditionEditor: "sql", dbType: "x" } as const;

	// @ts-expect-error no condition editor
	const _noEditor: IntegrationVariantMeta<"database"> = { group: "database", ...meta };
	const _kv: IntegrationVariantMeta<"kv"> = { group: "kv", ...meta };
	const _plugin: IntegrationVariantMeta<"acme/crm"> = { group: "acme/crm", ...meta };
	// @ts-expect-error no connect or create
	const _noHooks: IntegrationVariantDef<"database"> = { group: "database", ...meta, extras };
	const _db: IntegrationVariantDef<"database"> = {
		group: "database",
		...meta,
		extras,
		connect: () => ({ db: {}, close: async () => {} }),
		create: () => ({}) as DatabaseAdapter,
	};
	void [_noEditor, _kv, _plugin, _noHooks, _db];
}

void variantTypeChecks;
