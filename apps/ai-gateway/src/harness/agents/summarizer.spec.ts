import { describe, expect, it } from "bun:test";
import { SummarizerAgent } from "./summarizer";
import type { GlobalGraphState } from "../types";

function stateWith(harnessService: any): GlobalGraphState {
	return {
		orchestratorState: {
			tasks: [{ id: "t-1", title: "Create route", status: "completed" }],
			subAgentResults: { "t-1": { action: "create", data: { path: "/x" } } },
		},
		internal: {
			harnessService,
			metadata: { runId: "run-1" },
		},
		agentWrapper: {
			invokeAgent: async () => ({ content: "Built the route." }),
		},
	} as unknown as GlobalGraphState;
}

describe("summarizer without a model call", () => {
	it("writes the summary itself when the run is clean", async () => {
		const state = stateWith({
			createArtifact: async () => "art-1",
			createSubArtifact: async () => "sub-1",
		});
		// The model must not be reached at all — the whole point is the call
		// never happens, not that its output is discarded.
		(state as any).agentWrapper.invokeAgent = async () => {
			throw new Error("summarizer invoked the model on a clean run");
		};

		const result = await new SummarizerAgent(state).execute();

		expect(result.summarizerState?.markdown).toContain("Added the `/x` endpoint.");
		expect(result.summarizerState?.markdown).toContain(
			':route{type="add" sub_artifact_id="sub-1"}',
		);
	});

	it("still asks the model when a task failed", async () => {
		const state = stateWith({
			createArtifact: async () => "art-1",
			createSubArtifact: async () => "sub-1",
		});
		// A failure needs explaining in the user's language, and the deterministic
		// path has nothing to say about it.
		state.orchestratorState!.tasks!.push({
			id: "t-2",
			title: "Wire it up",
			status: "failed",
		} as any);

		const result = await new SummarizerAgent(state).execute();

		expect(result.summarizerState?.markdown).toBe("Built the route.");
	});
});

describe("summarizer artifact persistence", () => {
	it("still returns the summary when the artifact write fails", async () => {
		// The build's results are already applied by the time this node runs —
		// throwing here would fail the whole run and lose them.
		const result = await new SummarizerAgent(
			stateWith({
				createArtifact: async () => {
					throw new Error("connection terminated unexpectedly");
				},
			}),
		).execute();

		expect(result.summarizerState?.markdown).toBe("Built the route.");
		expect(result.summarizerState?.artifactId).toBeUndefined();
	});

	it("drops the chip for a sub-artifact that failed to persist", async () => {
		// A token whose id was never written would render a broken chip, so the
		// summary degrades to prose rather than referencing it.
		const result = await new SummarizerAgent(
			stateWith({
				createArtifact: async () => "art-1",
				createSubArtifact: async () => {
					throw new Error("deadlock detected");
				},
			}),
		).execute();

		expect(result.summarizerState?.markdown).toBe("Built the route.");
	});
});
