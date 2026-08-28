import { baseEnvSchema, createEnvValidator, validatePortString } from "@fluxify/common";
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

	LLM_TRACING_ENABLED: z
		.enum(["true", "false"])
		.optional()
		.describe("Enable OpenTelemetry tracing for LLM operations ('true' | 'false')"),

	LLM_OTLP_TRACES_ENDPOINT: z
		.string()
		.optional()
		.refine((val) => !val || z.string().url().safeParse(val).success, {
			message: "LLM_OTLP_TRACES_ENDPOINT must be a valid HTTP/HTTPS URL",
		})
		.describe("OTLP collector HTTP endpoint URL for LLM trace ingestion"),

	LLM_OTLP_TRACES_HEADERS: z
		.string()
		.max(1000)
		.optional()
		.describe("Additional HTTP headers for LLM trace exporter (max 1000 characters)"),

	LLM_TRACING_SAMPLE_RATE: z
		.string()
		.optional()
		.refine(
			(val) => {
				if (!val) return true;
				const num = Number(val);
				return !isNaN(num) && num >= 0.0 && num <= 1.0;
			},
			{ message: "LLM_TRACING_SAMPLE_RATE must be a float between 0.0 and 1.0" },
		)
		.describe("Sampling rate for LLM traces (0.0 to 1.0)"),

	HARNESS_CONCURRENT_JOBS: z
		.string()
		.optional()
		.refine(
			(val) => !val || (Number.isInteger(Number(val)) && Number(val) >= 1 && Number(val) <= 100),
			{ message: "HARNESS_CONCURRENT_JOBS must be an integer between 1 and 100" },
		)
		.describe("Harness runs one gateway worker executes at once (1-100, default 10)"),

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

export const OTLP_ENDPOINT = getEnv("OTLP_LOGS_ENDPOINT")!;
export const PG_URL = getEnv("PG_URL")!;
export const OTLP_AUTH_HEADER_NAME = getEnv("OTLP_AUTH_HEADER_NAME")!;
export const OTLP_AUTH_HEADER_VALUE = getEnv("OTLP_AUTH_HEADER_VALUE")!;
export const OTLP_LOGGER_ENABLED = getEnv("OTLP_LOGGER_ENABLED")!;

export const LLM_TRACING_ENABLED = getEnv("LLM_TRACING_ENABLED") === "true";
export const LLM_OTLP_TRACES_ENDPOINT = getEnv("LLM_OTLP_TRACES_ENDPOINT")!;
export const LLM_OTLP_TRACES_HEADERS = getEnv("LLM_OTLP_TRACES_HEADERS");
export const LLM_TRACING_SAMPLE_RATE = Number(getEnv("LLM_TRACING_SAMPLE_RATE") ?? "1.0");

export const OTLP_LOGGER_LEVEL: LogLevel =
	(getEnv("OTLP_LOGGER_LEVEL") as LogLevel) || "info";
export const NODE_ENV: EnvType =
	(getEnv("NODE_ENV") as EnvType) || "development";
export const REDIS_HOST = getEnv("REDIS_HOST")!;
export const REDIS_PORT = getEnv("REDIS_PORT")!;
export const REDIS_USER = getEnv("REDIS_USER")!;
export const REDIS_PASS = getEnv("REDIS_PASS")!;
/** How many harness runs one worker executes concurrently. Tune to available
 *  memory and expected AI workload — every slot holds a full graph run. */
export const HARNESS_CONCURRENT_JOBS = Number(getEnv("HARNESS_CONCURRENT_JOBS")) || 10;
export const AI_GATEWAY_PORT = Number(getEnv("AI_GATEWAY_PORT")) || 8001;
export const DOCS_INDEX_FILE_PATH =
	getEnv("DOCS_INDEX_FILE_PATH")! || "../dist/docs-index.bin";
