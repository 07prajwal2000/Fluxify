import type { ModelMessage } from "ai";
import { reviewContext } from "../review/context";
import { reviewPrompt, runReview, toFindings } from "../review/review";
import type { Check, Ctx, Task } from "./checks";
import type { Deps } from "./run";
import { sqlRoute } from "./tasks2";

/**
 * AI canvas review (#754) tasks. No agent loop: setup builds a canvas, the
 * review reads it as the job does, and the checks read its report.
 */

/** The request body pasted into the SQL text: injectable. */
const INJECTABLE_SQL =
	"const { name } = getRequestBody();\nreturn await dbQuery(`select id, email from users where name = '${name}'`);";

/** Runs the review of `ctx.seed.routeId` and keeps its report on `ctx.review`; the messages are for the judge. */
export async function reviewTurn(
	ctx: Ctx,
	deps: Deps,
	signal: AbortSignal,
): Promise<{ messages: ModelMessage[]; usage: { inputTokens: number; outputTokens: number } }> {
	const { context, blocks } = await reviewContext(
		ctx.api,
		ctx.projectId,
		"route",
		ctx.seed.routeId!,
	);
	const prompt = reviewPrompt(context);
	const { usage, summary, findings } = await runReview(
		deps.model,
		"route",
		prompt,
		deps.limits,
		signal,
	);
	const report = { summary, findings: toFindings(findings, blocks) };
	ctx.review = report;
	deps.write(`${JSON.stringify(report, null, 2)}\n`);
	return {
		messages: [
			{ role: "user", content: prompt },
			{ role: "assistant", content: JSON.stringify(report) },
		],
		usage,
	};
}

const securityFinding: Check = {
	name: "a security error on the db_native block",
	run: async (ctx) => {
		const hit = ctx.review?.findings.find(
			(f) =>
				f.category === "security" &&
				f.severity === "error" &&
				f.blockKeys.some((k) => k.startsWith("db_native")),
		);
		return hit
			? { pass: true, message: hit.message }
			: { pass: false, message: JSON.stringify(ctx.review?.findings ?? []).slice(0, 300) };
	},
};

export const reviewTasks: Task[] = [
	{
		id: "review-sql-injection",
		title: "AI review flags request input in native SQL",
		needsEnv: ["EVAL_POSTGRES_URL"],
		review: true,
		setup: (ctx) =>
			sqlRoute(
				ctx,
				{ name: "search users", method: "POST", path: "/users/search" },
				INJECTABLE_SQL,
			),
		prompt: "Review this route.",
		checks: [securityFinding],
		judge: [
			"Says the request body reaches the SQL text unescaped (SQL injection) and rates it an error",
			"Suggests a parameterized query ($1 with the value passed separately)",
			"Reports no problems the canvas does not have",
		],
	},
];
