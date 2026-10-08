import { httpcodes } from "@fluxify/lib";
import z from "zod";
import { baseBlockDataSchema } from "../baseBlock";
import { BlockTypes } from "../blockTypes";
import type { EmitNode } from "../compiler";

const isJs = (x: unknown): x is string => typeof x === "string" && x.startsWith("js:");

export const responseBlockSchema = z
	.object({
		/** a known code, or "js:" code returning one — the panel stores a typed code as a number */
		httpCode: z
			.union([z.string(), z.number()])
			.refine(
				(x) => (isJs(x) ? x.slice(3).trim() !== "" : httpcodes.some((y) => y.code == String(x))),
				{
					message: "Status code must be a known HTTP code or a js: expression",
				},
			)
			.describe(
				'a known HTTP status code like "200", or "js:" + a function body returning one at run time, e.g. "js: return input.created ? 201 : 200;"',
			),
		/** opt-in: run `transformScript` on the body before it is sent */
		transformEnabled: z.boolean().optional(),
		transformScript: z.string().optional(),
	})
	.extend(baseBlockDataSchema.shape);

export const responseAiDescription = {
	name: BlockTypes.response,
	description:
		'Terminates the request and returns the result to the client. Sets the status code; the body is whatever the previous block output. The status code is a fixed code, or "js:" code returning one when it depends on the flow (e.g. 201 when created, 200 when updated); an unknown code fails the block. Set transformEnabled + transformScript to reshape the body here (the script gets the body as `input` and its return value is sent), instead of adding a separate JS block.',
	jsonSchema: JSON.stringify(z.toJSONSchema(responseBlockSchema)),
	output:
		"Nothing: it ends the run and sends its input (or transformScript's return value) as the body. No block runs after it.",
	example: { httpCode: "js: return input ? 200 : 404;" },
};

/**
 * A fixed code is checked at save. A js: code is checked here, at run time:
 * an unknown code throws (so the error handler runs) instead of going out.
 * The known codes are inlined, not a `lib` helper — an artifact outlives the
 * runtime that compiled it.
 */
function statusCode(httpCode: string | number, node: EmitNode) {
	if (!isJs(httpCode)) return { setup: "", code: JSON.stringify(String(httpCode)) };
	const code = node.v("httpCode");
	const known = JSON.stringify(httpcodes.map((c) => c.code));
	return {
		setup: `const ${code} = String(${node.js(httpCode.slice(3), node.in)});
if (!${known}.includes(${code})) throw new Error(\`Response status code must be a known HTTP code, got \${${code}}\`);
`,
		code,
	};
}

/** terminal — nothing after a response block runs */
export function emitResponse(node: EmitNode) {
	const { httpCode, transformEnabled, transformScript } = responseBlockSchema.parse(
		node.block.data,
	);
	const status = statusCode(httpCode, node);
	const body =
		transformEnabled && transformScript?.trim() ? node.js(transformScript, node.in) : node.in;
	return `${status.setup}${node.complete(
		`{ successful: true, continueIfFail: true, responded: true, output: { httpCode: ${status.code}, body: ${body} ?? null } }`,
	)}`;
}

/**
 * The same block on a workflow canvas: terminal, and nothing else.
 *
 * A workflow is queued and runs with nobody attached, so there is no reply to
 * put a status code on. The configured `httpCode` is deliberately not read —
 * emitting it would produce a field no caller can ever see, and reading the
 * block's data would make a workflow fail to compile over a setting that
 * cannot matter to it.
 */
export function emitWorkflowEnd(node: EmitNode) {
	return node.complete(`{ successful: true, continueIfFail: true, output: ${node.in} ?? null }`);
}
