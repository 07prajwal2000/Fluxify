import { z } from "zod";

export const validatePortString = (val?: string) => {
	if (!val) return true;
	const num = Number(val);
	return !isNaN(num) && Number.isInteger(num) && num > 1000 && num <= 65535;
};

export const baseEnvSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "testing", "test", "ci", "staging"])
		.optional()
		.describe("Node execution environment mode (development | production | testing | test | ci | staging)"),

	ENVIRONMENT: z
		.enum(["development", "production", "testing", "test", "ci", "staging"])
		.optional()
		.describe("Application deployment environment (development | production | testing | test | ci | staging)"),

	PG_URL: z
		.string()
		.optional()
		.refine(
			(val) =>
				!val ||
				/^postgres(ql)?:\/\//.test(val) ||
				z.string().url().safeParse(val).success,
			{
				message: "PG_URL must be a valid PostgreSQL connection string or URL",
			},
		)
		.describe("PostgreSQL connection URL"),

	REDIS_HOST: z
		.string()
		.max(255)
		.optional()
		.describe("Redis server hostname or IP address (max 255 characters)"),

	REDIS_PORT: z
		.string()
		.optional()
		.refine(validatePortString, {
			message: "REDIS_PORT must be an integer between 1001 and 65535",
		})
		.describe("Redis server port number (1001-65535)"),

	REDIS_USER: z
		.string()
		.max(255)
		.optional()
		.describe("Redis authentication username (optional, max 255 characters)"),

	REDIS_PASS: z
		.string()
		.max(255)
		.optional()
		.describe("Redis authentication password (optional, max 255 characters)"),

	OTLP_LOGS_ENDPOINT: z
		.string()
		.optional()
		.refine((val) => !val || z.string().url().safeParse(val).success, {
			message: "OTLP_LOGS_ENDPOINT must be a valid HTTP/HTTPS URL",
		})
		.describe("OpenTelemetry OTLP log collector HTTP endpoint URL"),

	OTLP_AUTH_HEADER_NAME: z
		.string()
		.max(100)
		.optional()
		.describe("HTTP header name for OTLP exporter authentication (max 100 characters)"),

	OTLP_AUTH_HEADER_VALUE: z
		.string()
		.max(1000)
		.optional()
		.describe("HTTP header value for OTLP exporter authentication (max 1000 characters)"),

	OTLP_LOGGER_ENABLED: z
		.enum(["true", "false"])
		.optional()
		.describe("Enable OpenTelemetry logging exporter ('true' | 'false')"),

	OTLP_LOGGER_LEVEL: z
		.enum(["info", "warn", "error", "debug", "trace"])
		.optional()
		.describe("OpenTelemetry log level threshold (info | warn | error | debug | trace)"),

	NATS_URL: z
		.string()
		.optional()
		.refine(
			(val) =>
				!val ||
				/^nats:\/\//.test(val) ||
				z.string().url().safeParse(val).success,
			{ message: "NATS_URL must be a valid NATS connection URL (e.g. nats://localhost:4222)" },
		)
		.describe("NATS event bus server connection URL"),

	NATS_TOKEN: z
		.string()
		.max(255)
		.optional()
		.describe("Authentication token for NATS event bus (max 255 characters)"),

	CI: z
		.enum(["true", "false"])
		.optional()
		.describe("Continuous integration flag ('true' | 'false')"),
});

export function createEnvValidator<T extends z.ZodRawShape>(
	schema: z.ZodObject<T>,
	packageName: string,
) {
	let envInstance: z.infer<typeof schema> | undefined;

	function validateEnv(): z.infer<typeof schema> {
		if (envInstance) return envInstance;

		const result = schema.safeParse(process.env);
		if (!result.success) {
			console.error(`\n❌ ${packageName} Environment validation failed at startup:\n`);
			for (const issue of result.error.issues) {
				const key = issue.path.join(".");
				console.error(`  • \x1b[31m${key}\x1b[0m: ${issue.message}`);
			}
			console.error("\nPlease check your .env configuration and restart.\n");
			process.exit(1);
		}
		envInstance = result.data;
		return envInstance;
	}

	type KeyType = keyof z.infer<typeof schema>;

	function getEnv(key: KeyType): string | undefined {
		if (!envInstance) {
			validateEnv();
		}
		return (envInstance as any)[key];
	}

	return { validateEnv, getEnv };
}
