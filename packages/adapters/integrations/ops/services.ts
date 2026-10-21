import { type IntegrationOpContext, resolveMcpHeaders } from "@fluxify/sdk/integrations";
import { openMcpClient } from "../../mcp/client";
import type { McpOAuth } from "../../mcp/oauth";
import {
	kafkaVariantConfigSchema,
	mcpVariantConfigSchema,
	natsVariantConfigSchema,
	rabbitMqVariantConfigSchema,
	sqsVariantConfigSchema,
} from "../schemas";

/** The stored config with its `cfg:` references replaced by their values. */
export function expandCfg(config: Record<string, unknown>, appConfigs: Map<string, string>) {
	return Object.fromEntries(
		Object.entries(config).map(([key, value]) => [
			key,
			typeof value === "string" && value.startsWith("cfg:")
				? appConfigs.get(value.slice(4))
				: value,
		]),
	);
}

/** A queue client is loaded only when probed. Its schema's defaults apply. */
const queue = (
	schema: { parse(config: unknown): Record<string, unknown> },
	probe: () => Promise<(config: any) => Promise<any>>,
) => ({
	test: async (config: any, ctx: IntegrationOpContext) =>
		(await probe())(expandCfg(schema.parse(config), ctx.appConfig)),
});

export const QUEUE_OPS = {
	"queue/NATS": queue(
		natsVariantConfigSchema,
		async () => (await import("../../queue/nats")).testNatsConnection,
	),
	"queue/SQS": queue(
		sqsVariantConfigSchema,
		async () => (await import("../../queue/sqs")).testSqsConnection,
	),
	"queue/RabbitMQ": queue(
		rabbitMqVariantConfigSchema,
		async () => (await import("../../queue/rabbitmq")).testRabbitMqConnection,
	),
	"queue/Kafka": queue(
		kafkaVariantConfigSchema,
		async () => (await import("../../queue/kafka")).testKafkaConnection,
	),
};

export const MCP_OPS = {
	/** Connects, lists the tools, closes. Header values are never logged. */
	"mcp/http": {
		async test(stored: any, ctx: IntegrationOpContext) {
			const config = mcpVariantConfigSchema.parse(stored);
			const client = await openMcpClient({
				url: config.url,
				headers: resolveMcpHeaders(config.headers, ctx.appConfig),
				auth: config.auth === "oauth" ? "oauth" : undefined,
				oauth: ctx.options.oauth as McpOAuth | undefined,
			});
			try {
				const tools = await client.listTools();
				return {
					success: true,
					error: "",
					tools: tools.map((t) => ({ name: t.name, description: t.description ?? "" })),
				};
			} finally {
				await client.close();
			}
		},
	},
};
