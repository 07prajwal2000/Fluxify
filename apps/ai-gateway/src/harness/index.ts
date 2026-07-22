import {
	AgentFactory,
	type AgentFactoryOptions,
	type AgentProvider,
} from "./models/factory";
import {
	GraphState,
	type GlobalGraphState,
	type AgentNodeName,
	type CustomEventName,
} from "./types";
import { BaseAgentWrapper, type AgentInvokeOptions } from "./models/base";
import { app as graphApp } from "./graph";
import { DbService } from "./internal/dbService";
import {
	extractWorkingMemory,
	HarnessService,
	HitlPlanAction,
	RecordHitlActionInput,
	SaveLiveStateInput,
	UpsertStepInput,
} from "./internal/harnessService";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { HarnessCallbacks } from "./callbacks";
import { context as otelContext } from "@opentelemetry/api";
import { FLUXIFY_CONTEXT_KEY } from "@fluxify/common";

export interface HarnessStartOptions {
	conversationId: string;
	query: string;
}

export interface HarnessContinueOptions {
	conversationId: string;
	query?: string;
	action?: unknown; // TODO: implement core details of action (e.g. HITL, approvals) later
}

export class FluxifyHarness {
	private graph = graphApp;
	private dbService: DbService;
	private agentFactory: AgentFactory;
	private callbacksClass: typeof HarnessCallbacks;

	// Stateless constructor mapping dependencies
	constructor(
		agentFactory: AgentFactory,
		dbService: DbService = new DbService(),
		callbacksClass: typeof HarnessCallbacks = HarnessCallbacks,
	) {
		this.agentFactory = agentFactory;
		this.dbService = dbService;
		this.callbacksClass = callbacksClass;
	}

	public async start(options: HarnessStartOptions) {
		const initialState = await this.buildState(options);
		return await this.executeGraph(initialState);
	}

	public async continue(options: HarnessContinueOptions) {
		const stateUpdate = await this.buildState(options);
		return await this.executeGraph(stateUpdate);
	}

	// Load previous messages from DB using HarnessService
	public async loadMessages(
		conversationId: string,
		limit: number = 5,
	): Promise<BaseMessage[]> {
		const harnessService = new HarnessService(conversationId);
		return await harnessService.getConversationMessageHistory(limit);
	}

	private async buildState(
		options: HarnessStartOptions | HarnessContinueOptions,
	): Promise<Partial<GlobalGraphState>> {
		const harnessService = new HarnessService(options.conversationId);
		const messages = await harnessService.getConversationMessageHistory();
		if (options.query) {
			messages.push(new HumanMessage(options.query));
		}

		return {
			messages,
			userQuery: options.query,
			action: (options as HarnessContinueOptions).action,
			internal: { dbService: this.dbService, harnessService },
			agentWrapper: this.agentFactory.createAgent(),
		};
	}

	private async executeGraph(state: Partial<GlobalGraphState>) {
		// Instantiate the callback handler with the current state context
		const callbacks = new this.callbacksClass(state);
		const streamConfig: any = { version: "v2" };

		// Inject custom domain context for OTEL Custom Span Processor
		const activeContext = otelContext.active().setValue(FLUXIFY_CONTEXT_KEY, {
			userQuery: state.userQuery,
			action: state.action ? JSON.stringify(state.action) : undefined,
		});

		try {
			await otelContext.with(activeContext, async () => {
				const events = (await this.graph.streamEvents(
					state,
					streamConfig,
				)) as any;

				for await (const event of events) {
					if (event.event === "on_custom_event") {
						await callbacks.onCustomEvent(
							event.name as CustomEventName,
							event.data,
						);
					} else if (
						event.event === "on_chain_start" &&
						event.name !== "LangGraph"
					) {
						await callbacks.onBefore(event.name as AgentNodeName, event.data);
					} else if (event.event === "on_chain_end") {
						if (event.name === "LangGraph") {
							const finalState = event.data.output; // TODO: Do something with finalState
						} else {
							await callbacks.onAfter(event.name as AgentNodeName, event.data);
						}
					}
				}
			});
		} finally {
			if (state.internal?.harnessService) {
				await state.internal.harnessService.awaitAllPendingBackgroundTasks();
			}
		}
	}
}

export {
	AgentFactory,
	type AgentFactoryOptions,
	type AgentProvider,
	GraphState,
	type GlobalGraphState,
	BaseAgentWrapper,
	type AgentInvokeOptions,
	HarnessCallbacks,
	HarnessService,
	type UpsertStepInput,
	type SaveLiveStateInput,
	type HitlPlanAction,
	type RecordHitlActionInput,
	extractWorkingMemory,
	type AgentNodeName,
	type CustomEventName,
};
