import { BaseAgent } from "./base";
import type { GlobalGraphState } from "../types";
import { dispatchCustomEvent } from "@langchain/core/callbacks/dispatch";

export class RouterAgent extends BaseAgent {
  constructor(state: GlobalGraphState) {
    super(state);
  }

  async execute(): Promise<Partial<GlobalGraphState>> {
    // Dispatch an event to indicate agent status
    await dispatchCustomEvent("agent_status", { status: "thinking", agent: "router" });
    
    // Router logic will be implemented here
    return {};
  }
}
