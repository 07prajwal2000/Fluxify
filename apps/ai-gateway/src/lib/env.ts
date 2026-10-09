import { baseEnvSchema, createEnvValidator, logger, validatePortString } from "@fluxify/common";
import { z } from "zod";

type LogLevel = "info" | "warn" | "error" | "debug" | "trace";
type EnvType = "development" | "production" | "testing" | "test" | "ci" | "staging";

export const aiGatewayEnvSchema = baseEnvSchema.extend({
	AI_GATEWAY_PORT: z
		.string()
		.optional()
		.refine(validatePortString, {
			message: "AI_GATEWAY_PORT must be an integer between 1001 and 65535",
		})
		.describe("Port number for AI Gateway service (1001-65535)"),

	SERVER_PORT: z
		.string()
		.optional()
		.refine(validatePortString, {
			message: "SERVER_PORT must be an integer between 1001 and 65535",
		})
		.describe("Port of the admin API on this host; the MCP tools call it (default 5500)"),

	AGENT_CONCURRENT_JOBS: z
		.string()
		.optional()
		.refine(
			(val) => !val || (Number.isInteger(Number(val)) && Number(val) >= 1 && Number(val) <= 100),
			{ message: "AGENT_CONCURRENT_JOBS must be an integer between 1 and 100" },
		)
		.describe("Agent runs one gateway worker executes at once (1-100, default 10)"),

	AGENT_RUN_STALE_MS: z
		.string()
		.optional()
		.refine((val) => !val || (Number.isInteger(Number(val)) && Number(val) >= 30000), {
			message: "AGENT_RUN_STALE_MS must be an integer of at least 30000",
		})
		.describe(
			"Milliseconds an executing agent run may go without a heartbeat before it counts as dead (min 30000, default 120000)",
		),

	DOCS_INDEX_FILE_PATH: z
		.string()
		.max(500)
		.optional()
		.describe("File path to the documentation vector index binary file (max 500 characters)"),
});

// Extract keys using keyof
export type AiGatewayEnvKey = keyof z.infer<typeof aiGatewayEnvSchema>;

const validator = createEnvValidator(aiGatewayEnvSchema, "AI Gateway");
export const validateEnv = validator.validateEnv;
export const getEnv = validator.getEnv;

/** Reads `name`, or the pre-rename `oldName` (with a warning) when only that is set.
 *  ponytail: drop the fallbacks one release after the rename ships. */
export function envWithOldName(name: string, oldName: string): string | undefined {
	if (process.env[name] !== undefined) return process.env[name];
	if (process.env[oldName] === undefined) return undefined;
	logger.warn(`${oldName} is deprecated and will be removed; rename it to ${name}`, "Env");
	return process.env[oldName];
}

export const OTLP_ENDPOINT = getEnv("OTLP_LOGS_ENDPOINT")!;
export const PG_URL = getEnv("PG_URL")!;
export const OTLP_AUTH_HEADER_NAME = getEnv("OTLP_AUTH_HEADER_NAME")!;
export const OTLP_AUTH_HEADER_VALUE = getEnv("OTLP_AUTH_HEADER_VALUE")!;
export const OTLP_LOGGER_ENABLED = getEnv("OTLP_LOGGER_ENABLED")!;

export const OTLP_LOGGER_LEVEL: LogLevel = (getEnv("OTLP_LOGGER_LEVEL") as LogLevel) || "info";
export const NODE_ENV: EnvType = (getEnv("NODE_ENV") as EnvType) || "development";
export const REDIS_HOST = getEnv("REDIS_HOST")!;
export const REDIS_PORT = getEnv("REDIS_PORT")!;
export const REDIS_USER = getEnv("REDIS_USER")!;
export const REDIS_PASS = getEnv("REDIS_PASS")!;
/** How many agent runs one worker executes concurrently. Tune to available
 *  memory and expected AI workload — every slot holds a full agent run. */
export const AGENT_CONCURRENT_JOBS =
	Number(envWithOldName("AGENT_CONCURRENT_JOBS", "HARNESS_CONCURRENT_JOBS")) || 10;
/** An executing run with no heartbeat for this long lost its worker (#696). */
export const AGENT_RUN_STALE_MS = Number(getEnv("AGENT_RUN_STALE_MS")) || 120_000;
export const AI_GATEWAY_PORT = Number(getEnv("AI_GATEWAY_PORT")) || 8001;
/** The admin API the MCP tools call. It runs next to the gateway in every image. */
export const ADMIN_API_URL = `http://127.0.0.1:${Number(getEnv("SERVER_PORT")) || 5500}`;
export const DOCS_INDEX_FILE_PATH = getEnv("DOCS_INDEX_FILE_PATH")! || "../dist/docs-index.bin";
