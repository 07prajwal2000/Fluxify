import { BlockTypes } from "./blockTypes";

/**
 * A block text input is a literal unless it starts with `js:`. Agents and
 * people often write `{{ input.id }}` or a bare `input.id`, which is then saved
 * as plain text. Shared by the editor's diagnostics and the server's canvas
 * rules so the two say the same thing.
 */
export type LiteralExpressionIssue = { blockId: string; severity: "warning"; message: string };

export const TEMPLATE_MESSAGE =
	"`{{ }}` templates are not supported; use `js:` with a template string, e.g. `js: return `Hello ${input.name}``.";
export const BARE_EXPRESSION_MESSAGE =
	"This looks like an expression but has no `js:` prefix, so it is used as plain text. Write `js: return input.id`.";

/** fields that hold code, SQL or a name: `{{ }}` or `data.x` there is legitimate */
const SKIP_KEYS = new Set([
	"js",
	"transformScript",
	"raw",
	"tableName",
	"fieldMap",
	"blockName",
	"blockDescription",
]);
/** blocks whose text is code or a free note */
const SKIP_BLOCKS = new Set<string>([BlockTypes.jsrunner, BlockTypes.sticky_note]);
const BARE = /^\s*(input|vars|cfg|data)\./;

/** every string in a block's data, except under the skipped fields */
function* strings(value: unknown): Generator<string> {
	if (typeof value === "string") yield value;
	else if (value && typeof value === "object") {
		for (const [key, item] of Object.entries(value)) if (!SKIP_KEYS.has(key)) yield* strings(item);
	}
}

/** One warning per kind per block, for strings that look like an expression but lack `js:`. */
export function literalExpressionIssues(
	blocks: { id: string; type: string | null; data?: unknown }[],
): LiteralExpressionIssue[] {
	const issues: LiteralExpressionIssue[] = [];
	for (const block of blocks) {
		if (SKIP_BLOCKS.has(block.type ?? "")) continue;
		const texts = [...strings(block.data)].filter((text) => !text.startsWith("js:"));
		const warn = (message: string) =>
			issues.push({ blockId: block.id, severity: "warning", message });
		if (texts.some((text) => text.includes("{{"))) warn(TEMPLATE_MESSAGE);
		if (texts.some((text) => BARE.test(text))) warn(BARE_EXPRESSION_MESSAGE);
	}
	return issues;
}
