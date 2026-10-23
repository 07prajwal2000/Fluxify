import { logger } from "@fluxify/common";
import type z from "zod";
import {
	deleteCacheKey,
	deleteCacheKeysByPattern,
	getCache,
	setCacheEx,
} from "../../../../db/redis";
import { NotFoundError } from "../../../../errors/notFoundError";
import { projectHost } from "../../../../lib/hosting";
import { acceptedContentTypes } from "../../../../lib/routeConfig";
import { baseDomain, configuredBaseDomain } from "../../../../loaders/instanceSettingsLoader";
import { projectSettingsCache } from "../../../../loaders/projectSettingsLoader";
import type { OpenApiEnv, requestParamSchema } from "./dto";
import { getActiveRoutes, getProject } from "./repository";

export async function invalidateOpenApiCache(projectId?: string, env?: OpenApiEnv) {
	try {
		if (projectId) {
			if (env) {
				await deleteCacheKey(`openapi-spec:${projectId}:${env}`);
			} else {
				await deleteCacheKey(`openapi-spec:${projectId}`);
				await deleteCacheKey(`openapi-spec:${projectId}:production`);
				await deleteCacheKey(`openapi-spec:${projectId}:development`);
			}
		} else {
			await deleteCacheKeysByPattern(`openapi-spec:*`);
		}
	} catch (error) {
		logger.warn("Failed to invalidate OpenAPI cache", "openapi", { error });
	}
}

/** string `format` rule -> OpenAPI `format` */
const openApiFormats: Record<string, string> = {
	uuidv4: "uuid",
	uuidv7: "uuid",
	email: "email",
	url: "uri",
	ipv4: "ipv4",
	ipv6: "ipv6",
	datetime: "date-time",
};

function schemaDefToOpenApi(def: any): any {
	if (!def || typeof def !== "object") return {};

	const rules = def.rules || [];
	const requiredFields: string[] = [];
	const typeMap: any = {
		str: { type: "string" },
		int: { type: "integer" },
		float: { type: "number" },
		bool: { type: "boolean" },
		object: { type: "object" },
		arr: { type: "array" },
	};

	if (def.dataType === "enum") {
		const enumRule = rules.find((r: any) => r.type === "values");
		return { type: "string", enum: enumRule?.value || [] };
	}
	if (def.dataType === "js") {
		return { type: "object", description: "Custom JS validation" };
	}

	const result: any = { ...typeMap[def.dataType] };

	for (const rule of rules) {
		if (def.dataType === "str") {
			if (rule.type === "minLength" && rule.value != null) result.minLength = Number(rule.value);
			if (rule.type === "maxLength" && rule.value != null) result.maxLength = Number(rule.value);
			if (rule.type === "regex" && rule.value) result.pattern = rule.value;
			if (rule.type === "format" && openApiFormats[rule.value])
				result.format = openApiFormats[rule.value];
		}
		if (def.dataType === "int" || def.dataType === "float") {
			if (rule.type === "min" && rule.value != null) result.minimum = Number(rule.value);
			if (rule.type === "max" && rule.value != null) result.maximum = Number(rule.value);
		}
		if (def.dataType === "arr") {
			if (rule.type === "minItems" && rule.value != null) result.minItems = Number(rule.value);
			if (rule.type === "maxItems" && rule.value != null) result.maxItems = Number(rule.value);
		}
	}

	if (def.dataType === "object" && Array.isArray(def.properties)) {
		result.properties = {};
		for (const prop of def.properties) {
			result.properties[prop.key] = schemaDefToOpenApi(prop);
			if (prop.required !== false) {
				requiredFields.push(prop.key);
			}
		}
		if (requiredFields.length > 0) result.required = requiredFields;
	}

	if (def.dataType === "arr" && def.items) {
		result.items = schemaDefToOpenApi(def.items);
	}

	return result;
}

function buildParameter(
	schemaDef: unknown,
	inLocation: "query" | "path",
	operation: Record<string, unknown>,
) {
	const parsedDef = typeof schemaDef === "string" ? safelyParseJSON(schemaDef) : schemaDef;
	if (parsedDef && typeof parsedDef === "object") {
		try {
			const baseSchema = schemaDefToOpenApi(parsedDef);
			if (baseSchema.properties) {
				for (const [key, prop] of Object.entries(baseSchema.properties)) {
					(operation.parameters as any[]).push({
						name: key,
						in: inLocation,
						required: inLocation === "path" ? true : baseSchema.required?.includes(key) || false,
						schema: prop,
					});
				}
			}
		} catch (e) {
			logger.error(`Failed to parse ${inLocation} schema`, "openapi", { error: e });
		}
	}
}

function safelyParseJSON(str: string) {
	try {
		return JSON.parse(str);
	} catch (_e) {
		return null;
	}
}

/**
 * Where the project's APIs are served. Built per request, outside the cache, so
 * a subdomain or base domain change shows up at once. With no base domain set
 * (a local install) the request's own scheme and port are kept, as the
 * playground does.
 */
export function specServerUrl(
	projectId: string,
	requestOrigin: string,
	env: OpenApiEnv = "production",
) {
	const subdomain = projectSettingsCache[projectId]?.["settings.routing.subdomain"];
	const host = subdomain ? projectHost(subdomain, baseDomain()) : baseDomain();
	const base = configuredBaseDomain()
		? `https://${host}`
		: (() => {
				const url = new URL(requestOrigin);
				url.hostname = host;
				return url.origin;
			})();
	if (env === "development") {
		return `${base}/_/dev/`;
	}
	return base;
}

export async function generateOpenApiSpec(
	param: z.infer<typeof requestParamSchema>,
	requestOrigin: string,
	env: OpenApiEnv = "production",
) {
	const { projectId } = param;
	const servers = [{ url: specServerUrl(projectId, requestOrigin, env) }];
	const cacheKey = `openapi-spec:${projectId}:${env}`;
	const cached = await getCache(cacheKey);
	if (cached) {
		const { openapi, info, paths } = JSON.parse(cached);
		return { openapi, info, servers, paths };
	}

	const project = await getProject(projectId);
	if (!project) throw new NotFoundError("Project not found");

	const routes = await getActiveRoutes(projectId, env);
	const paths: Record<string, any> = {};

	for (const route of routes) {
		const method = (route.method || "get").toLowerCase();
		const path = (route.path || "/").replace(/:([a-zA-Z0-9_]+)/g, "{$1}");

		if (!paths[path]) paths[path] = {};

		const operation: Record<string, unknown> = {
			summary: route.name || "Untitled Route",
			operationId: route.id,
			parameters: [],
			responses: {
				"200": { description: "Successful response" },
			},
		};

		buildParameter(route.querySchema, "query", operation);
		buildParameter(route.paramsSchema, "path", operation);

		if (["post", "put", "patch"].includes(method) && route.bodySchema) {
			try {
				const parsedDef =
					typeof route.bodySchema === "string"
						? safelyParseJSON(route.bodySchema)
						: route.bodySchema;
				if (parsedDef && typeof parsedDef === "object") {
					const jsonSchema = schemaDefToOpenApi(parsedDef);
					// one entry per content type the route actually accepts
					operation.requestBody = {
						content: Object.fromEntries(
							acceptedContentTypes(route.routeConfig).map((contentType) => [
								contentType,
								{ schema: jsonSchema },
							]),
						),
					};
				}
			} catch (e) {
				logger.error("Failed to parse body schema", "openapi", { error: e });
			}
		}

		paths[path][method] = operation;
	}

	const openapi = {
		openapi: "3.0.0",
		info: {
			title: env === "development" ? `${project.name} (Development)` : project.name,
			version: "1.0.0",
		},
		paths,
	};

	await setCacheEx(cacheKey, JSON.stringify(openapi), 60 * 60);
	return { openapi: openapi.openapi, info: openapi.info, servers, paths };
}
