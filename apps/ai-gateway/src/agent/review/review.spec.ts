import { describe, expect, it } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import { parseLooseReport, reviewInstructions, runReview, toFindings } from "./review";

const limits = { idleMs: 1000, callMs: 5000, toolMs: 1000, retries: 0 };
const usage = {
	inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 5, text: 5, reasoning: 0 },
};
/** A model that answers `text`, ending with `finish`. */
const answering = (text: string, finish: "stop" | "length" = "stop") =>
	new MockLanguageModelV4({
		doGenerate: async () => ({
			content: [{ type: "text", text }],
			finishReason: { unified: finish, raw: finish },
			usage,
			warnings: [],
		}),
	});
const review = (text: string, finish?: "stop" | "length") =>
	runReview(answering(text, finish), "route", "<context/>", limits, new AbortController().signal);

const strict = {
	summary: "Reads users.",
	findings: [
		{
			severity: "error",
			category: "security",
			message: "SQL from the body.",
			suggestedFix: "Use $1.",
			blockKeys: ["db_native_1"],
		},
	],
};

describe("runReview", () => {
	it("reads a report that matches the schema", async () => {
		const r = await review(JSON.stringify(strict));
		expect(r).toEqual({ ...strict, usage: { inputTokens: 10, outputTokens: 5 } });
	});

	it("reads a report that misses the schema from the model's text", async () => {
		// a fence, prose around it, a severity and a category of its own, no fix or keys
		const text = `Here is the review:\n\`\`\`json\n${JSON.stringify({
			summary: "Reads users.",
			findings: [{ severity: "High", category: "Test Coverage", message: "No suites." }],
		})}\n\`\`\`\nHope it helps.`;
		const r = await review(text);
		expect(r.summary).toBe("Reads users.");
		expect(toFindings(r.findings, [])).toEqual([
			{
				severity: "error",
				category: "test_coverage",
				message: "No suites.",
				blockKeys: [],
				blockIds: [],
			},
		]);
	});

	it("says so when the answer holds no report", async () => {
		await expect(review("I could not review this.")).rejects.toThrow("not a report Fluxify could read");
	});

	it("says so when the report was cut off", async () => {
		await expect(review('{"summary": "Reads', "length")).rejects.toThrow("cut off");
	});
});

describe("parseLooseReport", () => {
	it("takes a bare findings array", () => {
		expect(parseLooseReport('[{"message": "m"}]')).toEqual({ findings: [{ message: "m" }] });
	});
	it("gives up on text with no JSON, or JSON that is not a report", () => {
		expect(parseLooseReport(undefined)).toBeUndefined();
		expect(parseLooseReport("nothing here")).toBeUndefined();
		expect(parseLooseReport('{"findings": [{"severity": "high"}]}')).toBeUndefined();
	});
});

describe("toFindings", () => {
	it("maps the usual severity words and falls back for unknown ones", () => {
		const out = toFindings(
			[
				{ message: "a", severity: "critical", category: "Security" },
				{ message: "b", severity: "Medium", category: "perf" },
				{ message: "c", severity: "low", category: "schema" },
				{ message: "d" },
			],
			[],
		);
		expect(out.map((f) => [f.severity, f.category])).toEqual([
			["error", "security"],
			["warning", "performance"],
			["info", "schema"],
			["warning", "correctness"],
		]);
	});
});

describe("reviewInstructions", () => {
	it("carries every review recipe, without frontmatter or doc links", () => {
		const text = reviewInstructions("route");
		for (const heading of [
			"Review recipe - security",
			"Review recipe - error handling",
			"Review recipe - correctness",
			"Review recipe - data integrity",
			"Review recipe - schema",
			"Review recipe - performance",
			"Review recipe - test coverage",
		])
			expect(text).toContain(heading);
		expect(text).not.toContain("description:");
		expect(text).not.toMatch(/\]\(\//);
	});
});
