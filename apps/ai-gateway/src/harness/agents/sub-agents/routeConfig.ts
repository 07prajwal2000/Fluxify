import { BaseAgent } from "../base";
import { type GlobalGraphState, AgentNode } from "../../types";
import { dispatchAgentEvent } from "../../callbacks";
import { z } from "zod";
import { searchDocsTool } from "../../tools/searchDocs";
import { createGetRouteDetailsTool } from "../../tools/getRouteDetails";
import { generateID } from "@fluxify/lib";

const routeConfigSchema = z.object({
	action: z
		.enum(["create", "delete", "update-partial"])
		.describe("The operation to perform"),
	routeId: z
		.string()
		.optional()
		.describe("The UUID of the route. Leave empty for create action."),
	data: z
		.object({
			method: z.string().optional(),
			path: z.string().optional(),
			bodySchema: z.any().optional(),
			paramsSchema: z.any().optional(),
			querySchema: z.any().optional(),
		})
		.optional()
		.describe("The configuration of the route"),
});

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
    { "type": "min", "value": 3, "message": "String must be at least 3 characters" }
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
          { "key": "role", "dataType": "enum", "rules": [ { "type": "enum", "value": ["admin", "user"] } ] }
        ]
      }
    }
  ]
}
\`\`\`

## Instructions
1. Analyze the assigned task to understand the exact route modifications required.
2. If you need to search for documentation about Javascript APIs, Scripting, or other Fluxify concepts, use the \`search_docs\` tool provided to you.
3. If you need to know the details of an existing route configuration to perform an update or deletion, use the \`get_route_details\` tool provided to you.
4. Determine if the action is \`create\`, \`delete\`, or \`update-partial\`.
5. If creating or updating a route, define the \`method\`, \`path\`, and relevant schemas in the \`data\` object.
6. **DO NOT generate a UUID for new routes.** Leave \`routeId\` empty/undefined when the action is \`create\`. The system will generate it.
7. If the action is \`update-partial\` or \`delete\`, you MUST include the \`routeId\` extracted from the task context.
8. Make sure to generate the schemas (\`bodySchema\`, \`querySchema\`, \`paramsSchema\`) exactly following the custom \`ValidationSchemaZod\` format above. 
9. The orchestrator will use your exact structured output to apply the changes after human approval.`;

		const userQuery = `Task Title: ${activeTask.title}
Task Description: ${activeTask.description}

Determine the exact route configuration intent. Use your tools if you need more context before generating the configuration schema.`;

		const tools = [
			searchDocsTool,
			createGetRouteDetailsTool(
				this.state.internal.dbService,
				this.state.internal?.metadata || {},
			),
		];

		const response = (await this.state.agentWrapper.invokeAgent({
			zodSchema: routeConfigSchema,
			systemPrompt,
			tools,
			messages: [],
			userQuery: userQuery,
		})) as z.infer<typeof routeConfigSchema>;

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

		// Ensure we initialize subAgentResults if it's undefined
		const currentResults = this.state.orchestratorState?.subAgentResults || {};

		return {
			currentAgent: AgentNode.ROUTE_CONFIG_AGENT,
			orchestratorState: {
				...this.state.orchestratorState,
				subAgentResults: {
					...currentResults,
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

	return null; // Valid
};
