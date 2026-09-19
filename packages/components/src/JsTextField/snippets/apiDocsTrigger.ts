import type { ApiDocItem } from "./types";

export const TRIGGER_DOCS: ApiDocItem[] = [
	{
		id: "api-trigger-data",
		name: "trigger.data",
		kind: "property",
		signature: "const trigger.data: Array<{ data: any; meta: Record<string, any> }>;",
		description:
			"Array of incoming trigger events with payload and metadata. Always an array, even for single events.",
		category: "variables",
		example:
			"// Incoming batch events array\nconst events = trigger.data;\nconst firstEvent = events[0]?.data;",
		returns: "Array<{ data: any; meta: Record<string, any> }>",
	},
	{
		id: "api-trigger-kind",
		name: "trigger.kind",
		kind: "property",
		signature: 'const trigger.kind: "route" | "job" | "workflow" | "cron" | "trigger";',
		description:
			'Execution origin type indicating what initiated the run ("route", "job", "workflow", "cron", or "trigger").',
		category: "variables",
		example: 'if (trigger.kind === "cron") {\n  // Handle scheduled execution\n}',
		returns: "string",
	},
	{
		id: "api-trigger-source",
		name: "trigger.source",
		kind: "property",
		signature: "const trigger.source: string;",
		description: 'Source connector or transport identifier (e.g. "http", "kafka", "nats", "cron").',
		category: "variables",
		example: "logger.logInfo({ source: trigger.source });",
		returns: "string",
	},
	{
		id: "api-trigger-reply",
		name: "trigger.reply",
		kind: "property",
		signature: 'const trigger.reply: "sync" | "async";',
		description:
			'Reply mode: "sync" when caller waits for response, or "async" for fire-and-forget.',
		category: "variables",
		example: 'if (trigger.reply === "async") {\n  // Fire-and-forget mode\n}',
		returns: "string",
	},
	{
		id: "api-trigger-id",
		name: "trigger.id",
		kind: "property",
		signature: "const trigger.id?: string;",
		description: "Optional correlation or message identifier for tracing and asynchronous replies.",
		category: "variables",
		example: "const correlationId = trigger.id;",
		returns: "string | undefined",
	},
	{
		id: "api-trigger-meta",
		name: "trigger.meta",
		kind: "property",
		signature: "const trigger.meta: { batchId: string; size: number; attempt?: number };",
		description: "Batch metadata including batchId, total batch size, and retry attempt count.",
		category: "variables",
		example:
			"const { batchId, size, attempt } = trigger.meta;\nlogger.logInfo({ batchId, size, attempt });",
		returns: "{ batchId: string; size: number; attempt?: number }",
	},
	{
		id: "api-trigger-connection",
		name: "trigger.connection",
		kind: "object",
		signature:
			"const trigger.connection?: { commit(): Promise<void>; moveToDLQ(error?: any): Promise<void>; lag(): Promise<number | null>; };",
		description:
			"Queue connection controls for external message stream triggers (Kafka, NATS): manual commit, moveToDLQ, and lag.",
		category: "variables",
		example: "if (trigger.connection) {\n  await trigger.connection.commit();\n}",
		returns: "TriggerConnection | undefined",
	},
];
