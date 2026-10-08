import { describe, expect, it } from "bun:test";
import { limitsFromProject } from "./timeouts";

const project = {
	"settings.ai.maxSteps": "60",
	"settings.ai.tokenBudget": "500000",
	"settings.ai.maxContextTokens": "32000",
};

describe("limitsFromProject", () => {
	it("uses the project values", () => {
		const l = limitsFromProject(project, {});
		expect([l.maxSteps, l.tokenBudget, l.maxContextTokens]).toEqual([60, 500000, 32000]);
	});

	it("leaves unset values to the agent defaults", () => {
		const l = limitsFromProject({}, {});
		expect([l.maxSteps, l.tokenBudget, l.maxContextTokens]).toEqual([undefined, undefined, undefined]);
	});

	it("lets env win over the project", () => {
		const l = limitsFromProject(project, { AGENT_MAX_STEPS: "5", AGENT_TOKEN_BUDGET: "20000" });
		expect([l.maxSteps, l.tokenBudget, l.maxContextTokens]).toEqual([5, 20000, 32000]);
	});
});
