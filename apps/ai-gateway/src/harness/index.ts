import { AgentFactory, type AgentFactoryOptions, type AgentProvider } from "./models/factory";
import { GraphState, type GlobalGraphState, type AgentNodeName, type CustomEventName } from "./types";
import { BaseAgentWrapper, type AgentInvokeOptions } from "./models/base";
import { app as graphApp } from "./graph";
import { DbService } from "./internal/dbService";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { HarnessCallbacks } from "./callbacks";

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
    dbService: DbService,
    callbacksClass: typeof HarnessCallbacks = HarnessCallbacks
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

  // Load previous messages from DB
  public async loadMessages(conversationId: string): Promise<BaseMessage[]> {
    // For now, returning current implementation logic (empty/dummy)
    return [];
  }

  private async buildState(
    options: HarnessStartOptions | HarnessContinueOptions
  ): Promise<Partial<GlobalGraphState>> {
    const messages = await this.loadMessages(options.conversationId);
    if (options.query) {
      messages.push(new HumanMessage(options.query));
    }

    return {
      messages,
      userQuery: options.query,
      action: (options as HarnessContinueOptions).action,
      internal: { dbService: this.dbService },
      agentWrapper: this.agentFactory.createAgent(),
    };
  }

  private async executeGraph(state: Partial<GlobalGraphState>) {
    // Instantiate the callback handler with the current state context
    const callbacks = new this.callbacksClass(state);
    const events = await this.graph.streamEvents(state, { version: "v2" });
    let finalState: any = null;

    for await (const event of events) {
      if (event.event === "on_custom_event") {
        await callbacks.onCustomEvent(event.name as CustomEventName, event.data);
      } else if (event.event === "on_chain_start" && event.name !== "LangGraph") {
        await callbacks.onBefore(event.name as AgentNodeName, event.data);
      } else if (event.event === "on_chain_end") {
        if (event.name === "LangGraph") {
          finalState = event.data.output;
        } else {
          await callbacks.onAfter(event.name as AgentNodeName, event.data);
        }
      }
    }
    return finalState;
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
  type AgentNodeName,
  type CustomEventName,
};


