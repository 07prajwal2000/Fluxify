import { describe, expect, it } from "bun:test";
import { AgentNode, type GlobalGraphState } from "../../../types";
import { validateBlockBuilderOutput } from "./validator";

const state = () =>
	({
		orchestratorState: {
			tasks: [
				{
					id: "config",
					title: "config",
					description: "",
					status: "completed",
					assignedAgentNode: AgentNode.CUSTOM_BLOCK_CONFIG_AGENT,
					dependsOnAgentId: [],
				},
				{
					id: "canvas",
					title: "canvas",
					description: "",
					status: "running",
					assignedAgentNode: AgentNode.BLOCK_BUILDER,
					dependsOnAgentId: ["config"],
				},
			],
			subAgentResults: {
				config: {
					customBlockId: "custom-1",
					data: { name: "example", inputParams: [] },
				},
			},
		},
	}) as unknown as GlobalGraphState;

const result = (notes: string) => ({
	status: "success" as const,
	targetType: "custom_block" as const,
	targetId: "custom-1",
	canvasChanges: [],
	blocks: [
		{
			id: "note",
			blockType: "sticky_note",
			position: { x: 0, y: 0 },
			data: { notes, color: "blue", size: { width: 200, height: 100 } },
			connections: [],
		},
	],
});

describe("validateBlockBuilderOutput", () => {
	it("does not treat literal params text as a caller parameter", async () => {
		expect(
			await validateBlockBuilderOutput(
				result("Show params.missing"),
				"canvas",
				state(),
			),
		).toBeNull();
	});

	it("still checks parameters used in executable expressions", async () => {
		expect(
			await validateBlockBuilderOutput(
				result("js:params.missing"),
				"canvas",
				state(),
			),
		).toContain('parameter "missing"');
	});
});
