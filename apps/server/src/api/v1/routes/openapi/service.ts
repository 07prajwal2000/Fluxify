import {
	getCache,
	setCacheEx,
	deleteCacheKey,
	deleteCacheKeysByPattern,
} from "../../../../db/redis";
import { getProject, getActiveRoutes } from "./repository";
import { JsVM } from "@fluxify/lib";
import z from "zod";
import { requestParamSchema } from "./dto";
import { NotFoundError } from "../../../../errors/notFoundError";

export async function invalidateOpenApiCache(projectId?: string) {
	if (projectId) {
		await deleteCacheKey(`openapi-spec:${projectId}`);
	} else {
		await deleteCacheKeysByPattern(`openapi-spec:*`);
	}
}

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
  operation: Record<string, unknown>
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
            required: inLocation === "path" ? true : (baseSchema.required?.includes(key) || false),
            schema: prop,
          });
        }
      }
    } catch (e) {
      console.error(`Failed to parse ${inLocation} schema:`, e);
    }
  }
}

function safelyParseJSON(str: string) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

export async function generateOpenApiSpec(
	param: z.infer<typeof requestParamSchema>,
) {
	const { projectId } = param;
	const cacheKey = `openapi-spec:${projectId}`;
	const cached = await getCache(cacheKey);
	if (cached) return JSON.parse(cached);

	const project = await getProject(projectId);
	if (!project) throw new NotFoundError("Project not found");

	const routes = await getActiveRoutes(projectId);
	const paths: Record<string, any> = {};
	const vm = new JsVM({});
	const context = { vm };

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
				const parsedDef = typeof route.bodySchema === "string" ? safelyParseJSON(route.bodySchema) : route.bodySchema;
				if (parsedDef && typeof parsedDef === "object") {
					const jsonSchema = schemaDefToOpenApi(parsedDef);
					operation.requestBody = {
						content: {
							"application/json": {
								schema: jsonSchema,
							},
						},
					};
				}
			} catch (e) {
				console.error("Failed to parse body schema:", e);
			}
		}

		paths[path][method] = operation;
	}

	const openapi = {
		openapi: "3.0.0",
		info: {
			title: project.name,
			version: "1.0.0",
		},
		paths,
	};

	await setCacheEx(cacheKey, JSON.stringify(openapi), 60 * 60);
	return openapi;
}
