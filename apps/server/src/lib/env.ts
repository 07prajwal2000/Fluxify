import { baseEnvSchema, createEnvValidator, validatePortString } from "@fluxify/common";
import { z } from "zod";

export const serverEnvSchema = baseEnvSchema.extend({
	SERVER_PORT: z
		.string()
		.optional()
		.refine(validatePortString, {
			message: "SERVER_PORT must be an integer between 1001 and 65535",
		})
		.describe("Port number for standalone admin control-plane server (1001-65535)"),

	WORKER_PORT: z
		.string()
		.optional()
		.refine(validatePortString, {
			message: "WORKER_PORT must be an integer between 1001 and 65535",
		})
		.describe("Port number for dedicated request router worker process (1001-65535)"),

	WORKER_HEALTH_PORT: z
		.string()
		.optional()
		.refine(validatePortString, {
			message: "WORKER_HEALTH_PORT must be an integer between 1001 and 65535",
		})
		.describe(
			"Port the compiled worker's supervisor serves health/readiness on (defaults to WORKER_PORT + 1)",
		),

	TELEMETRY_HEALTH_PORT: z
		.string()
		.optional()
		.refine(validatePortString, {
			message: "TELEMETRY_HEALTH_PORT must be an integer between 1001 and 65535",
		})
		.describe(
			"Port the telemetry worker serves health/readiness on (defaults to 5700)",
		),

	INTEGRATION_TIMEOUT_POLICY_IN_SEC: z
		.string()
		.optional()
		.refine(
			(val) => !val || (Number.isInteger(Number(val)) && Number(val) > 0),
			{ message: "INTEGRATION_TIMEOUT_POLICY_IN_SEC must be a positive integer" },
		)
		.describe(
			"Idle database integration timeout in seconds for compiled workers (default 450 / 7.5 minutes)",
		),

	WORKER_MAX_STREAM_SIZE: z
		.string()
		.optional()
		.refine(
			(val) => !val || (Number.isInteger(Number(val)) && Number(val) > 0),
			{ message: "WORKER_MAX_STREAM_SIZE must be a positive integer" },
		)
		.describe(
			"Hard cap on incoming request body size in kilobytes (default 8192 / 8 MB). Fluxify is an API server, not an upload gateway — raise it deliberately",
		),

	WORKER_PROJECT_ID: z
		.string()
		.optional()
		.describe(
			"Project this worker serves. The compiled worker watches only this project's artifacts and never connects to the database. Set to * to serve every project in the artifact bucket (single-tenant and dev deployments — route paths are shared across projects)",
		),

	WORKER_MODE: z
		.enum(["route", "workflow", "both"])
		.optional()
		.describe(
			"What this worker runs: route serves HTTP routes, workflow runs background workflows, both does either. Defaults to both. One mode per project — two workers on the same project in different modes is refused at boot",
		),

	AI_API_KEY: z
		.string()
		.max(255)
		.optional()
		.describe("API key for external AI provider (max 255 characters)"),

	SYSTEM_ACCESS_KEY: z
		.string()
		.max(255)
		.optional()
		.refine((val) => !val || val.length >= 8, {
			message: "SYSTEM_ACCESS_KEY must be at least 8 characters long when provided",
		})
		.describe("Secret key for machine-to-machine system API access (min 8 characters)"),

	MASTER_ENCRYPTION_KEY: z
		.string()
		.optional()
		.refine((val) => !val || Buffer.from(val, "base64").length === 32, {
			message: "MASTER_ENCRYPTION_KEY must be a base64-encoded 32-byte (256-bit) key",
		})
		.describe("Base64-encoded 32-byte key for AES-256-GCM encryption"),

	SEED_USER_EMAIL: z
		.string()
		.optional()
		.refine((val) => !val || z.string().email().safeParse(val).success, {
			message: "SEED_USER_EMAIL must be a valid email address",
		})
		.describe("Default email address for initial seed admin user"),

	SEED_USER_PASSWORD: z
		.string()
		.optional()
		.refine((val) => !val || val.length >= 8, {
			message: "SEED_USER_PASSWORD must be at least 8 characters long",
		})
		.describe("Default password for initial seed admin user (minimum 8 characters)"),

	SEED_USER_NAME: z
		.string()
		.optional()
		.refine((val) => !val || val.length >= 2, {
			message: "SEED_USER_NAME must be at least 2 characters long",
		})
		.describe("Default display name for initial seed admin user (minimum 2 characters)"),

	TRUSTED_ORIGINS: z
		.string()
		.optional()
		.refine(
			(val) =>
				!val ||
				val
					.split(",")
					.every((url) => z.string().url().safeParse(url.trim()).success),
			{ message: "TRUSTED_ORIGINS must be a comma-separated list of valid URLs" },
		)
		.describe("Comma-separated list of trusted origin URLs for CORS and Better Auth"),

	SERVER_URL: z
		.string()
		.optional()
		.refine((val) => !val || z.string().url().safeParse(val).success, {
			message: "SERVER_URL must be a valid HTTP/HTTPS URL",
		})
		.describe("Public base URL of the main server process"),

	ENABLE_BUILTIN_WORKER: z
		.enum(["true", "false"])
		.optional()
		.describe("Run embedded worker inside standalone server process ('true' | 'false')"),

	HOT_RELOAD_ROUTES: z
		.enum(["true", "false"])
		.optional()
		.describe("Live reload route definitions on save ('true' | 'false')"),

	ENABLE_ADMIN: z
		.enum(["true", "false"])
		.optional()
		.describe("Enable admin control-plane API endpoints ('true' | 'false')"),

	// Background job queue. One stream serves every kind of job, so these tune
	// the worker rather than any one feature.
	JOBS_CONCURRENCY: z
		.string()
		.optional()
		.describe("Background jobs this worker runs at once (default 5)"),

	JOBS_ACK_WAIT_MS: z
		.string()
		.optional()
		.describe("How long a job may run before it is assumed lost (default 300000)"),

	JOBS_MAX_DELIVER: z
		.string()
		.optional()
		.describe("Attempts before a failing job is dropped (default 5)"),

	JOBS_RETRY_DELAY_MS: z
		.string()
		.optional()
		.describe("Delay before a failed job is redelivered (default 10000)"),
});

// Extract keys using keyof
export type ServerEnvKey = keyof z.infer<typeof serverEnvSchema>;

const validator = createEnvValidator(serverEnvSchema, "Server");
export const validateEnv = validator.validateEnv;
export const getEnv = validator.getEnv;

export const OTLP_ENDPOINT = getEnv("OTLP_LOGS_ENDPOINT")!;
export const OTLP_AUTH_HEADER_NAME = getEnv("OTLP_AUTH_HEADER_NAME")!;
export const OTLP_AUTH_HEADER_VALUE = getEnv("OTLP_AUTH_HEADER_VALUE")!;
export const OTLP_LOGGER_ENABLED = getEnv("OTLP_LOGGER_ENABLED")!;
export const OTLP_LOGGER_LEVEL = getEnv("OTLP_LOGGER_LEVEL")!;
export const PG_URL = getEnv("PG_URL")!;
export const NATS_URL = getEnv("NATS_URL")!;
export const NATS_TOKEN = getEnv("NATS_TOKEN")!;
// true = run the API-serving worker inside this admin process (testing);
// false = admin is control-plane only, a separate worker node serves user APIs.
export const ENABLE_BUILTIN_WORKER = getEnv("ENABLE_BUILTIN_WORKER")!;
// which project's compiled artifacts this worker pulls and serves
export const WORKER_PROJECT_ID = getEnv("WORKER_PROJECT_ID")!;
/** what kind of work this worker takes on — see `jobs/subjects.ts` */
export const WORKER_MODE = getEnv("WORKER_MODE") || "both";

/** hard body-size ceiling for user-facing routes, in bytes (env is in KB) */
export const MAX_REQUEST_BODY_BYTES =
	(Number(getEnv("WORKER_MAX_STREAM_SIZE")) || 8192) * 1024;
