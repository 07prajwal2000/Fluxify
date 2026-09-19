import { dispatchAgentEvent } from "../callbacks";
import { AgentNode, type GlobalGraphState } from "../types";
import { BaseAgent } from "./base";

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
