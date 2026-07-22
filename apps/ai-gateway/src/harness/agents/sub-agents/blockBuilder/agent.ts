import { generateID } from "@fluxify/lib";
import type { z } from "zod";
import { BaseAgent } from "../../base";
import { type GlobalGraphState, AgentNode } from "../../../types";
import { dispatchAgentEvent } from "../../../callbacks";
import { searchDocsTool } from "../../../tools/searchDocs";
import { createGetRouteDetailsTool } from "../../../tools/getRouteDetails";
import { createFindResourceTool } from "../../../tools/findResource";
import { createGetBlockSchemasTool } from "../../../tools/getBlockSchemas";
import { createGetAgentOutputTool } from "../../../tools/getAgentOutput";
import { blockBuilderSchema } from "./schemas";
import {
	createBlocksTable,
	createSystemPrompt,
	createUserQuery,
} from "./promptHelpers";

export class BlockBuilderAgent extends BaseAgent {
	constructor(state: GlobalGraphState) {
		super(state);
	}

	private replaceShortIds<T>(value: T, shortIdMap: Map<string, string>): T {
		if (typeof value === "string") {
			return (shortIdMap.get(value) ?? value) as T;
		}

		if (Array.isArray(value)) {
			return value.map((item) => this.replaceShortIds(item, shortIdMap)) as T;
		}

		if (value && typeof value === "object") {
			return Object.fromEntries(
				Object.entries(value).map(([key, item]) => [
					key,
					this.replaceShortIds(item, shortIdMap),
				]),
			) as T;
		}

		return value;
	}

	private async getCustomBlocksInfo(projectId: string): Promise<string> {
		const customBlocks =
			await this.state.internal.dbService.getAllCustomBlocks(projectId);

		return customBlocks.length > 0
			? createBlocksTable(
					customBlocks.map(
						({
							name,
							label,
							description,
						}: { name: string; label: string; description: string }) => ({
							type: `custom:${name}`,
							name: label,
							description,
						}),
					),
				)
			: "No custom blocks available.";
	}

	async execute(): Promise<Partial<GlobalGraphState>> {
		const activeTask = this.state.activeTask;
		if (!activeTask) {
			throw new Error("BlockBuilderAgent requires an active task.");
		}

		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "Analyzing block builder requirements...",
				agent: AgentNode.BUILDER,
			},
		});

		const projectId = this.state.internal?.metadata?.projectId || "NONE";
		const customBlocksTable = await this.getCustomBlocksInfo(projectId);
		const systemPrompt = createSystemPrompt(customBlocksTable);
		const userQuery = createUserQuery(activeTask);

		const tools = [
			searchDocsTool,
			createGetRouteDetailsTool(
				this.state.internal.dbService,
				this.state.internal?.metadata || {},
			),
			createFindResourceTool(
				this.state.internal.dbService,
				this.state.internal?.metadata || {},
			),
			createGetBlockSchemasTool(this.state.internal.dbService, projectId),
			createGetAgentOutputTool(
				this.state.orchestratorState?.subAgentResults || {},
			),
		];

		const response = (await this.state.agentWrapper.invokeAgent({
			zodSchema: blockBuilderSchema,
			systemPrompt,
			tools,
			messages: [],
			userQuery,
		})) as z.infer<typeof blockBuilderSchema>;

		const shortIdMap = new Map(
			response.blocks
				.filter((block) => block.id.length <= 15)
				.map((block) => [block.id, generateID()]),
		);
		const processedResponse = this.replaceShortIds(response, shortIdMap);

		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "Block building intent formulated",
				agent: AgentNode.BUILDER,
				data: processedResponse,
			},
		});

		const currentResults = this.state.orchestratorState?.subAgentResults || {};

		return {
			currentAgent: AgentNode.BUILDER,
			orchestratorState: {
				...this.state.orchestratorState,
				subAgentResults: {
					...currentResults,
					[activeTask.id]: processedResponse,
				},
			},
		};
	}
}
