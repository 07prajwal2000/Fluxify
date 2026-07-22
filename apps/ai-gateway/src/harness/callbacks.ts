import type { GlobalGraphState, AgentNodeName, CustomEventName, AgentCustomEvent } from "./types";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";

export async function dispatchAgentEvent(event: AgentCustomEvent): Promise<void> {
  await dispatchCustomEvent(event.name, event.data);
}

export class HarnessCallbacks {
  protected state: Partial<GlobalGraphState>;

  constructor(state: Partial<GlobalGraphState>) {
    this.state = state;
  }

  public async onBefore(nodeName: AgentNodeName, eventData: any): Promise<void> {
    // Override this method to handle before node execution
  }

  public async onAfter(nodeName: AgentNodeName, eventData: any): Promise<void> {
    // Override this method to handle after node execution
  }

  public async onCustomEvent(eventName: CustomEventName, eventData: any): Promise<void> {
    // Override to handle dispatched custom events
  }
}
