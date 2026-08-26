import { BaseAgent } from "../base";
import { type GlobalGraphState, AgentNode } from "../../types";
import { dispatchAgentEvent } from "../../callbacks";
import { z } from "zod";
import { searchDocsTool } from "../../tools/searchDocs";
import { createGetRouteDetailsTool } from "../../tools/getRouteDetails";
import { generateID } from "@fluxify/lib";
import { buildAgentContext } from "../../internal/agentContext";

const ruleSchema = z.object({
	type: z.string(),
	value: z.any().optional(),
	message: z.string().optional(),
}).strict();

const paramFieldSchema = z.object({
	key: z.string().min(1),
	dataType: z.enum(["str", "int", "float", "bool", "enum"]),
	required: z.boolean(),
	rules: z.array(ruleSchema).optional(),
}).strict();

const queryFieldSchema = z.object({
	key: z.string().min(1),
	dataType: z.enum(["str", "int", "float", "bool", "arr", "enum"]),
	required: z.boolean().optional(),
	rules: z.array(ruleSchema).optional(),
	items: z.object({
		key: z.string(),
		dataType: z.enum(["str", "int", "float", "bool", "enum"]),
		rules: z.array(ruleSchema).optional(),
	}).strict().optional(),
}).strict();

const paramsSchemaOutput = z.object({
	dataType: z.literal("object"),
	properties: z.array(paramFieldSchema),
}).strict();

const querySchemaOutput = z.object({
	dataType: z.literal("object"),
	properties: z.array(queryFieldSchema),
}).strict();

const BODY_TYPES = ["str", "int", "float", "bool", "object", "arr", "enum", "js", "file", "blob"] as const;
const FORM_CONTENT_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data"]);
const bodyFieldSchema: z.ZodType = z.lazy(() => z.object({
	key: z.string(),
	dataType: z.enum(BODY_TYPES),
	required: z.boolean().optional(),
	rules: z.array(ruleSchema).optional(),
	js: z.string().optional(),
	properties: z.array(bodyFieldSchema).optional(),
	items: bodyFieldSchema.optional(),
}).strict());
const bodySchemaOutput = z.object({
	dataType: z.enum(BODY_TYPES),
	properties: z.array(bodyFieldSchema).optional(),
	items: bodyFieldSchema.optional(),
	rules: z.array(ruleSchema).optional(),
	js: z.string().optional(),
}).strict();

export const routeConfigOutputSchema = z.object({
	action: z
		.enum(["create", "delete", "update-partial"])
		.describe("The operation to perform"),
	routeId: z
		.string()
		.nullish()
		.describe("The UUID of the route. Leave empty for create action."),
	data: z
		.object({
			name: z
				.string()
				.nullish()
				.describe(
					"Short human-readable name for the route, e.g. 'Create Order'. Required when creating.",
				),
			method: z.string().nullish(),
			path: z.string().nullish(),
			bodySchema: bodySchemaOutput.nullish(),
			acceptedContentTypes: z.array(z.enum(["application/json", "application/x-www-form-urlencoded", "multipart/form-data", "application/octet-stream", "text/plain"])).min(1).nullish(),
			paramsSchema: paramsSchemaOutput.nullish(),
			querySchema: querySchemaOutput.nullish(),
		})
		.nullish()
		.describe("The configuration of the route"),
}).superRefine((value, ctx) => {
	if (!value.data?.bodySchema || !value.data.acceptedContentTypes?.some((type) => FORM_CONTENT_TYPES.has(type))) return;
	if ((value.data.bodySchema.properties ?? []).some((field: any) => field.properties || field.items)) {
		ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["data", "bodySchema"], message: "Form body schemas support top-level fields only." });
	}
});

const PARAM_DATA_TYPES = new Set(["str", "int", "float", "bool", "enum"]);
const QUERY_DATA_TYPES = new Set([...PARAM_DATA_TYPES, "arr"]);

function parameterSchemaError(
	schema: unknown,
	label: "paramsSchema" | "querySchema",
	allowedTypes: ReadonlySet<string>,
): string | null {
	if (!schema || typeof schema !== "object") {
		return `${label} must be an object schema.`;
	}
	const value = schema as { dataType?: unknown; properties?: unknown };
	if (value.dataType !== "object" || !Array.isArray(value.properties)) {
		return `${label} must use dataType "object" with a properties array.`;
	}
	const seen = new Set<string>();
	for (const property of value.properties) {
		if (!property || typeof property !== "object") {
			return `${label} contains an invalid property.`;
		}
		const field = property as { key?: unknown; dataType?: unknown };
		if (typeof field.key !== "string" || !field.key.trim()) {
			return `${label} properties require non-empty keys.`;
		}
		if (seen.has(field.key)) return `${label} cannot contain duplicate key "${field.key}".`;
		seen.add(field.key);
		if (typeof field.dataType !== "string" || !allowedTypes.has(field.dataType)) {
			return `${label} property "${field.key}" must use one of: ${[...allowedTypes].join(", ")}.`;
		}
	}
	return null;
}

export class RouteConfigAgent extends BaseAgent {
	constructor(state: GlobalGraphState) {
		super(state);
	}

	async execute(): Promise<Partial<GlobalGraphState>> {
		const activeTask = this.state.activeTask;
		if (!activeTask) {
			throw new Error("RouteConfigAgent requires an active task.");
		}

		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "Analyzing route configuration requirements...",
				agent: AgentNode.ROUTE_CONFIG_AGENT,
				agentId: activeTask.id,
			},
		});

		const context = buildAgentContext({
			currentContext: this.state.internal?.metadata?.contextBlock,
			projectInventory: this.state.internal?.metadata?.projectInventory,
			activeTask,
			subAgentResults: this.state.orchestratorState?.subAgentResults,
		});

		const systemPrompt = `You are the Route Config Agent for Fluxify — an Agentic Low Code Backend Development Platform.
Your responsibility is to determine the exact Create, Update, or Delete (CUD) intent for a route based on the task description.

## Route Schemas Overview
Fluxify routes use a structured data schema for validation.
Available schemas are:
- \`bodySchema\`: Validates the JSON data in the request body (POST, PUT).
- \`querySchema\`: Validates URL query parameters (e.g., ?page=2).
- \`paramsSchema\`: Validates URL path values (e.g., /users/:id). 

Path parameters must precisely match between the URL path (e.g. /:userId) and the \`paramsSchema\` keys.
All schemas use a structured JSON format that will later be converted to Zod on the backend. 

### Custom Schema Format (ValidationSchemaZod)
Fluxify uses a specific JSON format for schemas. DO NOT output standard JSON Schema. You MUST use this structure:

#### Example 1: Simple Primitive Schema (e.g. validating a string)
\`\`\`json
{
  "dataType": "str",
  "rules": [
    { "type": "minLength", "value": 3, "message": "String must be at least 3 characters" }
  ]
}
\`\`\`

#### Example 2: Simple Object Schema
\`\`\`json
{
  "dataType": "object",
  "properties": [
    {
      "key": "username",
      "dataType": "str",
      "required": true
    },
    {
      "key": "age",
      "dataType": "int",
      "required": false,
      "rules": [
        { "type": "min", "value": 18, "message": "Must be 18 or older" }
      ]
    }
  ]
}
\`\`\`

#### Example 3: Complex Schema with Array and Nested Object
\`\`\`json
{
  "dataType": "object",
  "properties": [
    {
      "key": "companyName",
      "dataType": "str",
      "required": true
    },
    {
      "key": "employees",
      "dataType": "arr",
      "required": true,
      "items": {
        "key": "employee",
        "dataType": "object",
        "properties": [
          { "key": "name", "dataType": "str", "required": true },
          { "key": "role", "dataType": "enum", "rules": [ { "type": "values", "value": ["admin", "user"] } ] }
        ]
      }
    }
  ]
}
\`\`\`

### Supported Types and Rules
- \`str\`: \`minLength\`, \`maxLength\`, \`regex\`, \`startsWith\`, \`endsWith\`, \`contains\`, \`notContains\`.
- \`int\` / \`float\`: \`min\`, \`max\`. \`bool\` has no rules.
- \`arr\`: \`items\` plus \`minItems\`, \`maxItems\`. \`enum\`: a \`values\` rule with an array of permitted values.
- \`object\`: a \`properties\` array. \`js\`: validator source in \`js\`. \`file\` / \`blob\`: \`minSize\`, \`maxSize\`, \`mimeTypes\`.

### Parameter Schema Rules
- \`paramsSchema\` is required when \`path\` has \`:parameters\`; otherwise omit it. It is an object with exactly one required property for every path parameter, using only \`str\`, \`int\`, \`float\`, \`bool\`, or \`enum\`. No nested objects, arrays, files, blobs, or JS validators.
- \`querySchema\`, when present, is an object. Its fields may use only \`str\`, \`int\`, \`float\`, \`bool\`, \`enum\`, or \`arr\`; query fields may be optional.
- Include \`acceptedContentTypes\` whenever body format matters. For \`application/json\`, body schemas may nest objects and arrays. For form types (\`application/x-www-form-urlencoded\` or \`multipart/form-data\`), body schema properties are top-level only: no nested \`properties\` or \`items\`.

## Instructions
1. Analyze the assigned task to understand the exact route modifications required.
2. If you need to search for documentation about Javascript APIs, Scripting, or other Fluxify concepts, use the \`search_docs\` tool provided to you — pass every topic you need as one array of queries in a SINGLE call, not one call per topic.
3. If you need to know the details of an existing route configuration to perform an update or deletion, use the \`get_route_details\` tool provided to you — unless the "Current context" block below already describes that exact route.
4. Determine if the action is \`create\`, \`delete\`, or \`update-partial\`.
5. If creating or updating a route, define the \`name\`, \`method\`, \`path\`, and relevant schemas in the \`data\` object.
   - \`name\` is REQUIRED for \`create\`. It is the label the user sees in the routes list, so write it in Title Case describing the operation — "Create Order", "List Users", "Delete Product By Id". Never leave it empty, never emit the path as the name.
   - For \`update-partial\`, only include \`name\` if the task actually asks to rename the route.
6. **DO NOT generate a UUID for new routes.** Leave \`routeId\` empty/undefined when the action is \`create\`. The system will generate it.
7. If the action is \`update-partial\` or \`delete\`, you MUST include the \`routeId\` extracted from the task context.
8. Make sure to generate the schemas (\`bodySchema\`, \`querySchema\`, \`paramsSchema\`) exactly following the custom \`ValidationSchemaZod\` format above. 
9. The orchestrator will use your exact structured output to apply the changes after human approval.`;

		const userQuery = `Task Title: ${activeTask.title}
Task Description: ${activeTask.description}
${activeTask.supervisorReviews ? `\nYour previous attempt was rejected. Fix this:\n${activeTask.supervisorReviews}\n` : ""}
Determine the exact route configuration intent. Use your tools if you need more context before generating the configuration schema.`;

		const tools = [
			searchDocsTool,
			createGetRouteDetailsTool(
				this.state.internal.dbService,
				this.state.internal?.metadata || {},
			),
		];

		const response = (await this.state.agentWrapper.invokeAgent({
			zodSchema: routeConfigOutputSchema,
			systemPrompt,
			context,
			tools,
			messages: [],
			userQuery: userQuery,
			agentNode: AgentNode.ROUTE_CONFIG_AGENT,
			agentId: activeTask.id,
		})) as z.infer<typeof routeConfigOutputSchema>;

		if (response.action === "create" && !response.routeId) {
			response.routeId = generateID();
		}

		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "Route configuration intent formulated",
				agent: AgentNode.ROUTE_CONFIG_AGENT,
				data: response,
				agentId: activeTask.id,
			},
		});

		return {
			currentAgent: AgentNode.ROUTE_CONFIG_AGENT,
			orchestratorState: {
				subAgentResults: {
					[activeTask.id]: response,
				},
			},
		};
	}
}

export const validateAgentOutput: import("../../types").AgentOutputValidator = (
	result,
	taskId,
	state,
) => {
	const typedResult = result as import("../../types").RouteConfigAgentResult;

	if (!typedResult.action) {
		return "Missing 'action' field. Must be one of: create, delete, update-partial.";
	}

	if (
		(typedResult.action === "update-partial" ||
			typedResult.action === "delete") &&
		!typedResult.routeId
	) {
		return `Action '${typedResult.action}' requires a valid 'routeId'.`;
	}

	if (typedResult.action !== "delete" && !typedResult.data) {
		return `Action '${typedResult.action}' requires a 'data' object with configuration details.`;
	}

	// The routes list shows `name`, not the path. A create that omits it lands a
	// nameless row the user has to go and fix by hand, so bounce it back here
	// rather than let the supervisor pass it.
	if (typedResult.action === "create" && !typedResult.data?.name?.trim()) {
		return "Action 'create' requires a non-empty 'data.name' — a short Title Case label for the route, e.g. 'Create Order'.";
	}

	const path = typedResult.data?.path;
	if (typeof path === "string") {
		const pathParams = Array.from(path.matchAll(/:([a-zA-Z0-9_]+)/g)).map((match) => match[1]!);
		if (pathParams.length > 0) {
			const error = parameterSchemaError(typedResult.data?.paramsSchema, "paramsSchema", PARAM_DATA_TYPES);
			if (error) return error;
			const properties = typedResult.data?.paramsSchema?.properties ?? [];
			const keys = properties.map((property: { key: string }) => property.key);
			const missing = pathParams.find((key) => !keys.includes(key));
			if (missing) return `paramsSchema is missing path parameter "${missing}".`;
			const extra = keys.find((key: string) => !pathParams.includes(key));
			if (extra) return `paramsSchema contains "${extra}", which is not declared in the route path.`;
			if (properties.some((property: { required?: unknown }) => property.required !== true)) {
				return "Every paramsSchema property must set required: true.";
			}
		} else if (typedResult.data?.paramsSchema != null) {
			return "Do not include paramsSchema when the route path has no :parameters.";
		}
	}

	if (typedResult.data?.querySchema != null) {
		const error = parameterSchemaError(typedResult.data.querySchema, "querySchema", QUERY_DATA_TYPES);
		if (error) return error;
	}

	return null; // Valid
};
