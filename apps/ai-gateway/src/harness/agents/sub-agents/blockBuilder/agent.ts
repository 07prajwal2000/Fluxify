import { logger } from "@fluxify/common";
import { generateID, resolveCustomBlockName } from "@fluxify/lib";
import type { z } from "zod";
import { BaseAgent } from "../../base";
import { type GlobalGraphState, AgentNode } from "../../../types";
import { dispatchAgentEvent } from "../../../callbacks";
import { searchDocsTool } from "../../../tools/searchDocs";
import { createGetRouteDetailsTool } from "../../../tools/getRouteDetails";
import { createFindResourceTool } from "../../../tools/findResource";
import { createGetCustomBlockSchemasTool } from "../../../tools/getBlockSchemas";
import { createGetAgentOutputTool } from "../../../tools/getAgentOutput";
import { fenceUntrusted } from "../../../internal/untrusted";
import { buildAgentContext } from "../../../internal/agentContext";
import { blockBuilderSchema } from "./schemas";
import { validateBlockBuilderOutput } from "./validator";
import {
	pendingCustomBlocks,
	type PendingCustomBlock,
} from "./pendingCustomBlocks";
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
	private async reconcileRouteTarget<
		T extends { targetType?: string | null; targetId?: string | null },
	>(
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

	/** Stored blocks, as the prompt table plus the names they are stored under.
	 *  The names are the inhouse guard: only a name absent from here may be
	 *  assumed to be a project block and given the `user_defined.project.`
	 *  prefix — inhouse and plugin blocks never went through the create endpoint
	 *  that adds it, so they are stored bare. */
	private async getCustomBlocksInfo(
		projectId: string,
	): Promise<{ table: string; names: string[] }> {
		const customBlocks =
			await this.state.internal.dbService.getAllCustomBlocks(projectId);
		const names = customBlocks.map(({ name }: { name: string }) => name);

		if (customBlocks.length === 0) {
			return { table: "No custom blocks available.", names };
		}

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
		return { table: fenceUntrusted("custom_blocks", table), names };
	}

	/**
	 * Rewrites every custom block reference to the name it is stored under.
	 *
	 * The prompt shows stored blocks by their full name and pending ones by the
	 * name they will get, but a model that types the bare `jwt_validate` anyway
	 * would persist it verbatim — `custom:` is stripped on the way into storage
	 * (`artifacts/normalize.ts`) and the compiled worker's library is keyed by
	 * the stored name, so the canvas would validate here and then fail to
	 * compile with "No codegen for block type".
	 */
	private canonicalizeCustomBlockTypes(
		response: z.infer<typeof blockBuilderSchema>,
		known: ReadonlySet<string>,
	) {
		const fix = (block: { blockType?: string }) => {
			const raw = block.blockType ?? "";
			const bare = raw.startsWith("custom:") ? raw.slice(7) : raw;
			const resolved = resolveCustomBlockName(bare, known);
			// A name that matches nothing is a built-in, a typo, or an invented
			// block. Leave it exactly as written: the validator's message for it
			// is more useful than one about a name this rewrote.
			if (!known.has(resolved) || resolved === bare) return;
			block.blockType = `custom:${resolved}`;
		};
		response.blocks?.forEach(fix);
		for (const change of response.canvasChanges ?? []) {
			if (change.type === "block_change") change.data.blocksInfo.forEach(fix);
		}
		return response;
	}

	/** Reads the same pending proposals the validator does, so the prompt cannot
	 *  call a block authoritative that validation then rejects as unknown. */
	private pairedCustomBlockContract(configs: PendingCustomBlock[]) {
		if (configs.length === 0) return "";
		return `#### Paired Custom Block Contracts (authoritative)\n${configs.map((config) => `- ${config.name} (${config.customBlockId}): ${JSON.stringify(config.inputParams)}`).join("\n")}`;
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
		const { table: customBlocksTable, names: storedCustomBlockNames } =
			await this.getCustomBlocksInfo(projectId);
		const context = buildAgentContext({
			currentContext: this.state.internal?.metadata?.contextBlock,
			projectInventory: this.state.internal?.metadata?.projectInventory,
			activeTask,
			subAgentResults: this.state.orchestratorState?.subAgentResults,
		});
		const prefetchedDocs = (await getDocsByTitle(PREFETCH_DOC_TITLES))
			.map((doc) => doc.content)
			.join("\n\n---\n\n");
		const pending = pendingCustomBlocks(this.state, activeTask.id);
		// Stored names plus the names this run's proposals will be stored under.
		const knownCustomBlockNames = new Set([
			...storedCustomBlockNames,
			...pending.map((block) => block.name),
		]);
		const systemPrompt = createSystemPrompt(
			customBlocksTable,
			prefetchedDocs,
			this.pairedCustomBlockContract(pending),
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
			createGetCustomBlockSchemasTool(
				this.state.internal.dbService,
				projectId,
				new Map(pending.map((block) => [block.name, block.inputParams])),
			),
			createGetAgentOutputTool(
				this.state.orchestratorState?.subAgentResults || {},
			),
		];

		const response = (await this.state.agentWrapper.invokeAgent({
			zodSchema: blockBuilderSchema,
			systemPrompt,
			context,
			tools,
			messages: [],
			userQuery,
			agentNode: AgentNode.BLOCK_BUILDER,
			agentId: activeTask.id,
			validateResult: (candidate) =>
				validateBlockBuilderOutput(candidate, activeTask.id, this.state),
		})) as z.infer<typeof blockBuilderSchema>;

		const shortIdMap = new Map(
			response.blocks
				.filter((block) => block.id.length <= 15)
				.map((block) => [block.id, generateID()]),
		);
		const processedResponse = await this.reconcileRouteTarget(
			this.canonicalizeCustomBlockTypes(
				this.replaceShortIds(this.stripEchoedMetadata(response), shortIdMap),
				knownCustomBlockNames,
			),
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

		return {
			currentAgent: AgentNode.BLOCK_BUILDER,
			orchestratorState: {
				subAgentResults: {
					[activeTask.id]: processedResponse,
				},
			},
		};
	}
}
