import {
	BUILT_IN_GROUP_LABELS,
	builtInVariantMeta,
} from "@fluxify/adapters/integrations/builtinVariants";
import type z from "zod";
import {
	type aiVariantSchema,
	type baasVariantSchema,
	databaseVariantSchema,
	type kafkaVariantConfigSchema,
	type kvVariantSchema,
	type mcpVariantConfigSchema,
	type mcpVariantSchema,
	type memcachedVariantConfigSchema,
	type mongoVariantConfigSchema,
	type mysqlVariantConfigSchema,
	type natsVariantConfigSchema,
	type observabilityVariantSchema,
	type openAIVariantConfigSchema,
	type openAiCompatibleVariantConfigSchema,
	type openTelemetryVariantConfigSchema,
	type postgresVariantConfigSchema,
	type queueVariantSchema,
	type rabbitMqVariantConfigSchema,
	type redisVariantConfigSchema,
	type sqsVariantConfigSchema,
} from "./schemas";

type Variants =
	| keyof typeof databaseVariantSchema.enum
	| keyof typeof queueVariantSchema.enum
	| keyof typeof kvVariantSchema.enum
	| keyof typeof observabilityVariantSchema.enum
	| keyof typeof aiVariantSchema.enum
	| keyof typeof baasVariantSchema.enum
	| keyof typeof mcpVariantSchema.enum;

/**
 * Pure on purpose: the portal imports this file. Server code reads the variant
 * list and validates through `integrationRegistry`, which also holds plugin variants.
 */
export const humanReadableConnectorNames = BUILT_IN_GROUP_LABELS;

export function getDefaultVariantValue(variant: Variants) {
	if (variant === "PostgreSQL" || variant === "MongoDB") {
		return {
			host: "",
			port: 0,
			database: "",
			username: "",
			password: "",
			dbType:
				variant === "PostgreSQL"
					? databaseVariantSchema.enum.PostgreSQL
					: databaseVariantSchema.enum.MongoDB,
			url: "",
			useSSL: false,
			source: "credentials",
		} as z.infer<typeof postgresVariantConfigSchema> | z.infer<typeof mongoVariantConfigSchema>;
	}
	if (variant === "MySQL") {
		return {
			host: "",
			port: 0,
			database: "",
			username: "",
			password: "",
			dbType: databaseVariantSchema.enum.MySQL,
			url: "",
			source: "credentials",
		} as z.infer<typeof mysqlVariantConfigSchema>;
	}
	// no legacy alias here: this supplies blank form defaults for a variant the
	// user just picked from the current enum, never for a stored row
	if (variant === "Open Telemetry" || variant === "Loki") {
		return {
			baseUrl: "",
			credentials: {
				username: "",
				password: "",
			},
			headers: {},
		} as z.infer<typeof openTelemetryVariantConfigSchema>;
	}
	if (
		variant === "OpenAI" ||
		variant === "Anthropic" ||
		variant === "Gemini" ||
		variant === "Mistral"
	) {
		return {
			apiKey: "",
			model: "",
		} as z.infer<typeof openAIVariantConfigSchema>;
	}
	if (variant === "OpenAI Compatible") {
		return {
			apiKey: "",
			model: "",
			baseUrl: "",
		} as z.infer<typeof openAiCompatibleVariantConfigSchema>;
	}
	if (variant === "Redis" || variant === "Memcached") {
		return {
			host: "",
			port: 0,
			username: "",
			password: "",
			source: "credentials",
		} as z.infer<typeof redisVariantConfigSchema> | z.infer<typeof memcachedVariantConfigSchema>;
	}
	if (variant === "Kafka") {
		return {
			brokers: "",
			clientId: "",
			ssl: false,
			saslMechanism: "none",
			username: "",
			password: "",
			dlqTopic: "",
		} as z.infer<typeof kafkaVariantConfigSchema>;
	}
	if (variant === "NATS") {
		return {
			servers: "",
			tls: false,
			token: "",
			user: "",
			pass: "",
			creds: "",
			nkeySeed: "",
			dlqSubject: "",
		} as z.infer<typeof natsVariantConfigSchema>;
	}
	if (variant === "SQS") {
		return {
			region: "",
			accessKeyId: "",
			secretAccessKey: "",
			sessionToken: "",
			endpoint: "",
		} as z.infer<typeof sqsVariantConfigSchema>;
	}
	if (variant === "RabbitMQ") {
		return {
			host: "",
			port: "",
			username: "",
			password: "",
			database: "",
			useSSL: false,
			source: "credentials",
		} as z.infer<typeof rabbitMqVariantConfigSchema>;
	}
	if (variant === "http") {
		return { url: "", headers: [], auth: "headers" } as z.infer<typeof mcpVariantConfigSchema>;
	}
	return null;
}

/** A built-in variant's config schema, for the portal's forms; null when it is not one. */
export function getSchema(group: string, variant: string): z.ZodType | null {
	return builtInVariantMeta(group, variant)?.configSchema ?? null;
}
