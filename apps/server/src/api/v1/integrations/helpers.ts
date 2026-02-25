import z, { ZodObject, ZodType } from "zod";
import {
	integrationsGroupSchema,
	databaseVariantSchema,
	postgresVariantConfigSchema,
	mysqlVariantConfigSchema,
	mongoVariantConfigSchema,
	kvVariantSchema,
	observabilityVariantSchema,
	openObserveVariantConfigSchema,
	baasVariantSchema,
	aiVariantSchema,
	lokiVariantConfigSchema,
	openAIVariantConfigSchema,
	anthropicVariantConfigSchema,
	openAiCompatibleVariantConfigSchema,
	geminiVariantConfigSchema,
	mistralVariantConfigSchema,
} from "./schemas";

type Variants =
	| keyof typeof databaseVariantSchema.enum
	| keyof typeof kvVariantSchema.enum
	| keyof typeof observabilityVariantSchema.enum
	| keyof typeof aiVariantSchema.enum
	| keyof typeof baasVariantSchema.enum;

export const humanReadableConnectorNames = {
	database: "Databases",
	kv: "Key Value store",
	ai: "AI",
	baas: "Backend as a Service",
	observability: "Observability",
};

export function getIntegrationsGroups() {
	return Object.values(integrationsGroupSchema.options);
}

export function getIntegrationsVariants(
	group: z.infer<typeof integrationsGroupSchema>,
) {
	if (group === "database") {
		return Object.values(databaseVariantSchema.options);
	}
	if (group === "observability") {
		return Object.values(observabilityVariantSchema.options);
	}
	if (group === "ai") {
		return Object.values(aiVariantSchema.options);
	}
	return [];
}

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
		} as
			| z.infer<typeof postgresVariantConfigSchema>
			| z.infer<typeof mongoVariantConfigSchema>;
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
	if (variant === "Open Observe" || variant === "Loki") {
		return {
			baseUrl: "",
			credentials: {
				username: "",
				password: "",
			},
		} as z.infer<typeof openObserveVariantConfigSchema>;
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
	return null;
}

export function getSchema(
	group: z.infer<typeof integrationsGroupSchema>,
	variant: string,
) {
	let schema: z.ZodType = null!;
	if (group === "database") {
		const result = databaseVariantSchema.safeParse(variant);
		if (!result.success) {
			return null;
		}
		switch (variant as z.infer<typeof databaseVariantSchema>) {
			case "PostgreSQL":
				schema = postgresVariantConfigSchema;
				break;
			case "MySQL":
				schema = mysqlVariantConfigSchema;
				break;
			case "MongoDB":
				schema = mongoVariantConfigSchema;
				break;
			default:
				return null;
		}
	} else if (group === "kv") {
		const result = kvVariantSchema.safeParse(variant);
		if (!result.success) {
			return null;
		}
		switch (variant as z.infer<typeof kvVariantSchema>) {
			default:
				return null;
		}
	} else if (group === "observability") {
		const result = observabilityVariantSchema.safeParse(variant);
		if (!result.success) {
			return null;
		}
		switch (variant as z.infer<typeof observabilityVariantSchema>) {
			case "Open Observe":
				schema = openObserveVariantConfigSchema;
				break;
			case "Loki":
				schema = lokiVariantConfigSchema;
				break;
		}
	} else if (group === "ai") {
		const result = aiVariantSchema.safeParse(variant);
		if (!result.success) {
			return null;
		}
		switch (variant as z.infer<typeof aiVariantSchema>) {
			case "OpenAI":
				schema = openAIVariantConfigSchema;
				break;
			case "Anthropic":
				schema = anthropicVariantConfigSchema;
				break;
			case "Gemini":
				schema = geminiVariantConfigSchema;
				break;
			case "Mistral":
				schema = mistralVariantConfigSchema;
				break;
			case "OpenAI Compatible":
				schema = openAiCompatibleVariantConfigSchema;
				break;
		}
	}
	return schema;
}
