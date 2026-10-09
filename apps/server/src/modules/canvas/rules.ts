import { BlockTypes, blockDataIssues, literalExpressionIssues } from "@fluxify/blocks";
import type { CustomBlockUsage } from "../../db/schema";
import { reachabilityIssues } from "./reachability";
import type { CanvasParentType } from "./types";

/**
 * The canvas rules that depend on WHICH canvas a block sits on: a route, a
 * workflow or a custom block. One copy, on the server, because they need the
 * project's custom blocks from the DB. Every writer reaches them through
 * `saveCanvas`: the portal save, the ops bus and the MCP `edit_canvas`.
 *
 * Errors block a save. Warnings never do (a canvas being built is allowed to be
 * half done, as in the portal); they come back from a dry-run save.
 */
export type CanvasIssue = { severity: "error" | "warning"; message: string; blockId?: string };

export type RulesInput = {
	kind: CanvasParentType;
	/** the usage of the custom block whose canvas this is; unset for routes and workflows */
	selfUsage?: CustomBlockUsage;
	/** `key` is the readable name (`if_1`); a message falls back to the id without it */
	blocks: { id: string; key?: string; type: string | null; data: unknown }[];
	edges: { from?: string | null; to?: string | null; fromHandle?: string | null }[];
	/** the project's custom blocks, by name */
	usageOf: Map<string, CustomBlockUsage>;
};

/** Blocks that read or write the HTTP request. A workflow runs off a queue with none. */
const HTTP_BLOCKS = new Set<string>([
	BlockTypes.httpGetHeader,
	BlockTypes.httpSetHeader,
	BlockTypes.httpGetParam,
	BlockTypes.httpGetCookie,
	BlockTypes.httpSetCookie,
	BlockTypes.httpGetRequestBody,
]);

/** JS API names that need an HTTP request (see `contextVarsAiDescription`). */
const REQUEST_API =
	/\b(getRequestBody|getQueryParam|getRouteParam|getHeader|setHeader|getCookie|setCookie|httpRequestMethod|httpRequestRoute)\b/;
/** JS API names that only an after middleware fills in. */
const RESPONSE_API = /\b(getResponseBody|getResponseStatus)\b/;

/** every string inside a block's data: scripts and inline `js:` values live there */
function strings(value: unknown, out: string[] = []): string[] {
	if (typeof value === "string") out.push(value);
	else if (value && typeof value === "object")
		for (const v of Object.values(value)) strings(v, out);
	return out;
}

/** The first API name in the block's data that the regex matches. */
function usesApi(data: unknown, api: RegExp) {
	// ponytail: matches the name in plain text too (a log message, a comment).
	// Only warnings use it; parse the JS if that ever misleads.
	for (const text of strings(data)) {
		const hit = api.exec(text);
		if (hit) return hit[1];
	}
	return undefined;
}

function blockIssues(block: RulesInput["blocks"][number], input: RulesInput): CanvasIssue[] {
	const { kind, selfUsage, usageOf } = input;
	const type = block.type ?? "";
	const out: CanvasIssue[] = [];
	const add = (severity: CanvasIssue["severity"], message: string) =>
		out.push({ severity, message, blockId: block.id });

	const usage = usageOf.get(type);
	if (usage === "test" && selfUsage !== "test") {
		add("error", `${type} is a test-only block: use it only as a test suite's setup or teardown.`);
	}
	// #534: a middleware block runs only as a link of a middleware chain
	if (usage === "middleware") {
		add("error", `${type} is a middleware block: add it to a middleware instead of a canvas.`);
	}

	if (kind === "workflow") {
		if (type === BlockTypes.response) {
			add(
				"warning",
				"A Response block does nothing in a workflow: nobody waits for a reply. The run just ends here.",
			);
		}
		if (HTTP_BLOCKS.has(type)) {
			add(
				"warning",
				`${type} works on an HTTP request, and a workflow has none. Read trigger.data instead.`,
			);
		}
		const api = usesApi(block.data, REQUEST_API);
		if (api) {
			add(
				"warning",
				`${api} needs an HTTP request, and a workflow has none. Read trigger.data instead.`,
			);
		}
	}
	if (selfUsage !== "middleware") {
		const api = usesApi(block.data, RESPONSE_API);
		if (api) add("warning", `${api} only works in an after middleware. It returns null here.`);
	}
	return [...out, ...blockDataIssues([block]), ...literalExpressionIssues([block])];
}

/** All rule issues of a canvas as it will be after a save. */
export function canvasRuleIssues(input: RulesInput): CanvasIssue[] {
	return [
		...input.blocks.flatMap((block) => blockIssues(block, input)),
		...reachabilityIssues(input),
	];
}
