import type { GlobalGraphState, AgentNodeName, CustomEventName } from "./types";

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
