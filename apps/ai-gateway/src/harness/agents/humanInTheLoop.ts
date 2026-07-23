import { BaseAgent } from "./base";
import { type GlobalGraphState, AgentNode } from "../types";
import { dispatchAgentEvent } from "../callbacks";

export class HumanInTheLoopAgent extends BaseAgent {
	constructor(state: GlobalGraphState) {
		super(state);
	}

	async execute(): Promise<Partial<GlobalGraphState>> {
		await dispatchAgentEvent({
			name: "agent_status",
			data: {
				status: "Waiting for human approval...",
				agent: AgentNode.HUMAN_IN_THE_LOOP,
			},
		});

		return {
			currentAgent: AgentNode.HUMAN_IN_THE_LOOP,
			nextRoute: undefined,
		};
	}
}
