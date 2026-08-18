import { logger } from "@fluxify/common";
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
import { fenceUntrusted } from "../../../internal/untrusted";
import { blockBuilderSchema } from "./schemas";
import {
	createBlocksTable,
	createSystemPrompt,
	createUserQuery,
	PREFETCH_DOC_TITLES,
} from "./promptHelpers";
import { getDocsByTitle } from "../../../../db/vector";

export class BlockBuilderAgent extends BaseAgent {
	constructor(state: GlobalGraphState) {
		super(state);
	}

	/**
	 * `targetId` is copied by the model from another agent's output, and a model
	 * that mistypes or invents it produces a canvas hanging off a route that does
	 * not exist — which only surfaces at apply time, as a 404. The run already
	 * knows the answer: if the id names no live route and this run configured
	 * exactly one, that route is the target.
	 */
	private async reconcileRouteTarget<T extends { targetType?: string; targetId?: string }>(
		result: T,
		projectId: string,
	): Promise<T> {
		if (result.targetType !== "route" || !result.targetId) return result;

		const plannedRouteIds = Object.values(
			this.state.orchestratorState?.subAgentResults ?? {},
		)
			.map((value) => (value as { routeId?: string; action?: string }) ?? {})
			.filter((value) => value.routeId && value.action !== "delete")
			.map((value) => value.routeId as string);

		if (plannedRouteIds.includes(result.targetId)) return result;
		if (plannedRouteIds.length !== 1) return result;

		// an id this run did not plan is still fine if the project really has it
		const live = await this.state.internal?.dbService?.getRouteDetails(
			projectId,
			result.targetId,
		);
		if (live) return result;

		logger.warn("[BlockBuilder] Re-pointing canvas target at the route this run created", {
			claimed: result.targetId,
			actual: plannedRouteIds[0],
		});
		return { ...result, targetId: plannedRouteIds[0] };
	}

	/**
	 * Models like to echo `blockName`/`blockDescription` back inside `data`,
	 * where they mean nothing to the block schemas and just double the tokens
	 * on every canvas round-trip. Drop them — the real ones live on the block.
	 */
	private stripEchoedMetadata(response: z.infer<typeof blockBuilderSchema>) {
		const clean = (block: { data?: Record<string, unknown> | null }) => {
			if (!block?.data) return;
			delete block.data.blockName;
			delete block.data.blockDescription;
			delete block.data.blockType;
		};
		response.blocks?.forEach(clean);
		for (const change of response.canvasChanges ?? []) {
			if (change.type === "block_change") change.data.blocksInfo.forEach(clean);
		}
		return response;
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

		if (customBlocks.length === 0) return "No custom blocks available.";

		const table = createBlocksTable(
			customBlocks.map(
				({
					name,
					label,
					description,
					inputParams,
				}: {
					name: string;
					label: string;
					description: string;
					inputParams?: unknown[];
				}) => ({
					type: `custom:${name}`,
					name: label,
					description: `${description} Caller parameters: ${JSON.stringify(inputParams ?? [])}`,
				}),
			),
		);

		// Names, labels and descriptions authored by whoever built the custom
		// block — untrusted, and this one lands in the system prompt rather than
		// in a tool result, so it needs the fence more than most.
		return fenceUntrusted("custom_blocks", table);
	}

	private pairedCustomBlockContract() {
		const configs = Object.values(this.state.orchestratorState?.subAgentResults ?? {})
			.map((value) => value as { customBlockId?: string; data?: { name?: string; inputParams?: unknown[] } })
			.filter((value) => value.customBlockId && value.data?.name);
		if (configs.length === 0) return "";
		return `#### Paired Custom Block Contracts (authoritative)\n${configs.map((config) => `- ${config.data?.name} (${config.customBlockId}): ${JSON.stringify(config.data?.inputParams ?? [])}`).join("\n")}`;
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
				agent: AgentNode.BLOCK_BUILDER,
				agentId: activeTask.id,
			},
		});

		const projectId = this.state.internal?.metadata?.projectId || "NONE";
		const customBlocksTable = await this.getCustomBlocksInfo(projectId);
		const contextBlock = this.state.internal?.metadata?.contextBlock;
		const prefetchedDocs = (await getDocsByTitle(PREFETCH_DOC_TITLES))
			.map((doc) => doc.content)
			.join("\n\n---\n\n");
		const systemPrompt = createSystemPrompt(
			customBlocksTable,
			prefetchedDocs,
			this.pairedCustomBlockContract(),
		);
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
			context: contextBlock,
			tools,
			messages: [],
			userQuery,
			agentNode: AgentNode.BLOCK_BUILDER,
			agentId: activeTask.id,
		})) as z.infer<typeof blockBuilderSchema>;

		const shortIdMap = new Map(
			response.blocks
				.filter((block) => block.id.length <= 15)
				.map((block) => [block.id, generateID()]),
		);
		const processedResponse = await this.reconcileRouteTarget(
			this.replaceShortIds(this.stripEchoedMetadata(response), shortIdMap),
			projectId,
		);

		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "Block building intent formulated",
				agent: AgentNode.BLOCK_BUILDER,
				data: processedResponse,
				agentId: activeTask.id,
			},
		});

		const currentResults = this.state.orchestratorState?.subAgentResults || {};

		return {
			currentAgent: AgentNode.BLOCK_BUILDER,
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
