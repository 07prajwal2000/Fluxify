import { BlockTypes } from "../blockTypes";
import z from "zod";
import { baseBlockDataSchema } from "../baseBlock";
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
        'used when useValue is false: target block id -> condition for that case. "js:" + a JavaScript function body runs as code and matches when it returns a truthy value, e.g. "js: return input.age >= 18;". Plain text is not code: "false" never matches, any other text always matches. An empty or missing condition never matches',
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
        'used when useValue is true: target block id -> the value that picks that case. Plain text is compared as a string; use "js:" for any other type, e.g. "js: return 404;". An empty or missing entry never matches',
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
- This block has NO 'source' handle. When no case matches, the route ends here.
- A JS condition must start with "js:" and \`return\` its result, e.g. "js: return input.total > 100;". Without "js:" it is plain text and always matches (except "false").
- For a default case in conditions mode, use "true" and put it last in data.order.`,
};

const JS_PREFIX = "js:";

/** code behind an optional `js:` prefix, trimmed */
function code(raw: string | undefined) {
  const text = (raw ?? "").trim();
  return text.startsWith(JS_PREFIX) ? text.slice(JS_PREFIX.length).trim() : text;
}

/** a missing, blank, or empty `js:` entry picks nothing */
const isBlank = (raw: string | undefined) => !code(raw);

/** a case's guard, or undefined when the case can never run */
function conditionTest(raw: string | undefined, node: EmitNode) {
  if (isBlank(raw)) return undefined;
  const text = raw!.trim();
  if (text.startsWith(JS_PREFIX)) return `$truthy(${node.js(code(text), node.in)})`;
  // plain text is a fixed answer, never code
  return text.toLowerCase() === "false" ? undefined : "true";
}

export function emitSwitch(node: EmitNode) {
  const data = switchBlockSchema.parse(node.block.data);
  let prelude = "";
  let test: (to: string) => string | undefined;

  if (data.useValue) {
    const value = node.v("value");
    prelude = `const ${value} = ${node.js(code(data.value), node.in)};\n`;
    test = (to) =>
      isBlank(data.matches[to]) ? undefined : `${value} === ${node.value(data.matches[to])}`;
  } else {
    test = (to) => conditionTest(data.conditions[to], node);
  }

  const checks = node.cases("case", data.order).flatMap((branch) => {
    const expr = test(branch.to);
    return expr ? [`if (${expr}) {\n${branch.run}\n}`] : [];
  });
  return `${prelude}${checks.join("\n")}
${node.next()}`;
}
