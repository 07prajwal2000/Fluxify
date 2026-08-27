import { BlockTypes } from "@fluxify/blocks";
import type { RouteConfigAgentResult, SubAgentResult, Task } from "../../../types";
import type { PendingCustomBlock } from "./pendingCustomBlocks";
import type { BlockBuilderResult } from "./schemas";

/**
 * Canvases the run can write without asking a model.
 *
 * A build is four model calls — router, planner/task generator, route config,
 * block builder — and for the simplest route the last one adds nothing a
 * template cannot: entrypoint, a body, a response. Skipping it is a whole model
 * call and its retry budget off a build the user experiences as trivial.
 *
 * Every gate here is structural, never a reading of what the user meant. A
 * template that guesses wrong produces a confidently incorrect route, which is
 * worse than the slow correct one — so anything a gate cannot prove falls
 * through to the real agent, and the caller runs the output through the same
 * validator the model's output goes through.
 */

/**
 * Words that mean the route needs something a fixed body cannot give it.
 * Matched whole-word against the task text with the body literal removed.
 *
 * Deliberately narrow: every entry names a capability, never a turn of phrase.
 * "api", "request", "body" and "endpoint" appear in almost every description of
 * a route that genuinely is static, so blocking on them would leave a template
 * that never fires — which is a different way of being wrong.
 */
const NEEDS_AN_AGENT =
	/\b(database|db|table|rows?|columns?|sql|quer(?:y|ies)|select|insert|update|delete|postgres|mysql|mongo|fetch|webhook|external|upstream|third-party|auth|authenticated?|authorization|authorize|token|jwt|session|login|password|params?|parameters?|headers?|cookies?|querystring|input|form|variables?|loop|iterate|foreach|conditional|condition|branch|validates?|validation|transforms?|custom|log|logs|logging|email|upload|files?|random|uuid|timestamps?|calculate)\b/i;

/**
 * The first complete JSON object in `text`, string-aware.
 *
 * `lastIndexOf("}")` guesses wrong the moment a brace appears in a string value
 * or later in the sentence, and this decides what a route returns — so count.
 */
function firstJsonObject(text: string): { literal: string; value: unknown } | null {
	const start = text.indexOf("{");
	if (start === -1) return null;

	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === '"') inString = !inString;
		if (inString) continue;
		if (char === "{") depth++;
		if (char === "}" && --depth === 0) {
			const literal = text.slice(start, i + 1);
			try {
				return { literal, value: JSON.parse(literal) };
			} catch {
				return null;
			}
		}
	}
	return null;
}

/** The route this task builds a canvas for, but only when this run is creating
 *  it — a route that already exists has a canvas the template cannot see, and
 *  overwriting it is exactly the damage this must never do. */
function newRouteTarget(
	task: Task,
	results: Record<string, SubAgentResult> | undefined,
): string | null {
	// One dependency, so the canvas has one unambiguous origin. A task depending
	// on several is coordinating something a template has no view of.
	if (task.dependsOnAgentId?.length !== 1) return null;
	const route = results?.[task.dependsOnAgentId[0]] as
		| RouteConfigAgentResult
		| undefined;
	if (route?.action !== "create" || !route.routeId) return null;
	return route.routeId;
}

/**
 * `entrypoint → jsrunner(fixed body) → response`, for a new route whose task
 * spells its response body out as JSON.
 *
 * The literal is the proof: a task carrying one has already decided what the
 * route returns, so there is nothing left for a model to work out. Everything
 * else — a body assembled from a request, a row read from a table, anything
 * named in `NEEDS_AN_AGENT` — returns null and costs the run nothing.
 *
 * ponytail: matches only a body written as JSON in the task text. A request
 * phrased entirely in prose falls through to the agent, which is the correct
 * outcome, just not a cheaper one.
 */
export function staticResponseTemplate(
	task: Task,
	results: Record<string, SubAgentResult> | undefined,
	pending: PendingCustomBlock[],
): BlockBuilderResult | null {
	if (pending.length > 0) return null;

	const targetId = newRouteTarget(task, results);
	if (!targetId) return null;

	const text = `${task.title} ${task.description}`;
	const body = firstJsonObject(text);
	if (!body) return null;

	// A second object literal means the task describes more than one shape, and
	// which one the route returns is a judgement call rather than a reading.
	const rest = text.replace(body.literal, " ");
	if (rest.includes("{")) return null;
	if (NEEDS_AN_AGENT.test(rest)) return null;

	// Two status codes is a branch — which one the route returns depends on
	// something, and working out what is the agent's job, not a template's.
	const codes = new Set(rest.match(/\b[1-5]\d\d\b/g) ?? []);
	if (codes.size > 1) return null;
	// An invalid or non-2xx code is caught by the response block's schema when
	// the caller validates this, so it falls through rather than shipping.
	const httpCode = [...codes][0] ?? "200";

	return {
		status: "success",
		targetType: "route",
		targetId,
		canvasChanges: [],
		blocks: [
			{
				id: "tpl_entry",
				blockType: BlockTypes.entrypoint,
				blockName: "Entrypoint",
				blockDescription: "Receives the incoming request.",
				data: {},
				position: { x: 0, y: 0 },
				connections: [{ blockId: "tpl_body", handle: "source" as const }],
			},
			{
				id: "tpl_body",
				blockType: BlockTypes.jsrunner,
				blockName: "Response Body",
				blockDescription: "Returns the fixed response body.",
				data: { value: `return ${body.literal};` },
				position: { x: 232, y: 0 },
				connections: [{ blockId: "tpl_response", handle: "source" as const }],
			},
			{
				id: "tpl_response",
				blockType: BlockTypes.response,
				blockName: "Response",
				blockDescription: `Returns ${httpCode} to the client.`,
				data: { httpCode },
				position: { x: 464, y: 0 },
				connections: [],
			},
		],
	};
}
