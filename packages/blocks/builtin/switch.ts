import z from "zod";
import { baseBlockDataSchema } from "../baseBlock";
import { BlockTypes } from "../blockTypes";
import type { EmitNode } from "../compiler";

export const switchBlockSchema = z
	.object({
		order: z
			.array(z.string())
			.optional()
			.default([])
			.describe(
				"target block ids of the 'case' connections, in the order they are checked; unlisted connections are checked last",
			),
		conditions: z
			.record(z.string(), z.string())
			.optional()
			.default({})
			.describe(
				'used when useValue is false: target block id -> condition for that case. "js:" + a JavaScript function body that matches when it returns a truthy value, e.g. "js: return input.age >= 18;". Plain text matches when the input === that literal (numbers and true/false are typed, anything else is a string). Empty or missing conditions never match',
			),
		useValue: z
			.boolean()
			.optional()
			.default(false)
			.describe(
				"true: run `value` once, then pick the first case whose `matches` entry equals its result (===)",
			),
		value: z
			.string()
			.optional()
			.default("")
			.describe(
				'used when useValue is true: JavaScript function body returning the value to switch on, e.g. "return input.status;"',
			),
		matches: z
			.record(z.string(), z.string())
			.optional()
			.default({})
			.describe(
				'used when useValue is true: target block id -> the value that picks that case. Plain text is a literal: numbers and true/false are typed, anything else is a string; use "js:" for any other value, e.g. "js: return null;". An empty or missing entry never matches',
			),
		defaultCase: z
			.string()
			.optional()
			.default("")
			.describe(
				"target block id of the 'case' connection that runs when no other case matches; its condition/match is ignored",
			),
	})
	.extend(baseBlockDataSchema.shape);

export const switchAiDescription = {
	name: BlockTypes.switch,
	description:
		"Branches like a multi-way IF. Every block connected to its 'case' handle is one case, keyed by that block's id. Cases are checked in data.order and the first match runs with this block's input; the rest are skipped. Two modes: conditions (default, each case has a condition) or useValue (a value script runs once and each case has a value compared with ===).",
	jsonSchema: JSON.stringify(z.toJSONSchema(switchBlockSchema)),
	handleInfo: `
Handles:
- 'case': Connect the first block of each case. Any number of connections.

Constraints:
- This block has NO 'source' handle. When no case matches and there is no default case, the route ends here and returns this block's input.
- A condition is either plain text, matched when the input === that literal (e.g. paid, 404, true; numbers and booleans are typed), or "js:" code that \`return\`s a truthy value, e.g. "js: return input.total > 100;".
- For a default case, set data.defaultCase to its target block id; it runs only when no other case matches and needs no condition. Never use "js: return true;" as a default.`,
};

const JS_PREFIX = "js:";

/** code behind an optional `js:` prefix, trimmed */
function code(raw: string | undefined) {
	const text = (raw ?? "").trim();
	return text.startsWith(JS_PREFIX) ? text.slice(JS_PREFIX.length).trim() : text;
}

/** a missing, blank, or empty `js:` entry picks nothing */
const isBlank = (raw: string | undefined) => !code(raw);

/** plain text as a JS literal, typed at compile time: numbers and booleans stay unquoted */
function literal(text: string) {
	if (text === "true" || text === "false") return text;
	if (/^-?\d+(\.\d+)?$/.test(text)) return String(Number(text));
	return JSON.stringify(text);
}

/** `js:` code as an expression, plain text as a typed literal */
function plainOrJs(raw: string, node: EmitNode) {
	const text = raw.trim();
	return text.startsWith(JS_PREFIX) ? node.value(text) : literal(text);
}

/** a case's guard, or undefined when the case can never run: `js:` code is truthy-tested, plain text is === the input */
function conditionTest(raw: string | undefined, node: EmitNode) {
	const text = (raw ?? "").trim();
	if (isBlank(text)) return undefined;
	if (text.startsWith(JS_PREFIX)) return `$truthy(${node.js(code(text), node.in)})`;
	return `${node.in} === ${literal(text)}`;
}

export function emitSwitch(node: EmitNode) {
	const data = switchBlockSchema.parse(node.block.data);
	let prelude = "";
	let test: (to: string) => string | undefined;

	if (data.useValue) {
		const value = node.v("value");
		prelude = `const ${value} = ${node.js(code(data.value), node.in)};\n`;
		test = (to) =>
			isBlank(data.matches[to]) ? undefined : `${value} === ${plainOrJs(data.matches[to]!, node)}`;
	} else {
		test = (to) => conditionTest(data.conditions[to], node);
	}

	const cases = node.cases("case", data.order);
	// the default case has no guard: it runs once every other case missed
	const fallback = cases.find((branch) => branch.to === data.defaultCase);
	const checks = cases.flatMap((branch) => {
		const expr = branch === fallback ? undefined : test(branch.to);
		return expr ? [`if (${expr}) {\n${branch.run}\n}`] : [];
	});
	const next = node.next();
	return `${prelude}${checks.join("\n")}
${fallback ? fallback.run : next}`;
}
