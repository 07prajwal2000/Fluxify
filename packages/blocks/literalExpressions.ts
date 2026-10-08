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

export const CODE_JS_PREFIX_MESSAGE =
	"`js:` is only for text inputs; code fields are already JavaScript. It was ignored.";

/** each block's field that is already full JS; the compiler drops a leading `js:` there */
const CODE_FIELDS: Record<string, string> = {
	[BlockTypes.jsrunner]: "value",
	[BlockTypes.transformer]: "js",
	[BlockTypes.kv_raw]: "js",
	[BlockTypes.db_native]: "js",
	[BlockTypes.response]: "transformScript",
};
const JS_PREFIX = /^\s*js:/;

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

/**
 * One warning per kind per block, for strings that look like an expression but
 * lack `js:`, and for a `js:` at the top of a code field.
 */
export function literalExpressionIssues(
	blocks: { id: string; type: string | null; data?: unknown }[],
): LiteralExpressionIssue[] {
	const issues: LiteralExpressionIssue[] = [];
	for (const block of blocks) {
		const warn = (message: string) =>
			issues.push({ blockId: block.id, severity: "warning", message });
		const code = (block.data as Record<string, unknown> | undefined)?.[
			CODE_FIELDS[block.type ?? ""] ?? ""
		];
		if (typeof code === "string" && JS_PREFIX.test(code)) warn(CODE_JS_PREFIX_MESSAGE);
		if (SKIP_BLOCKS.has(block.type ?? "")) continue;
		const texts = [...strings(block.data)].filter((text) => !text.startsWith("js:"));
		if (texts.some((text) => text.includes("{{"))) warn(TEMPLATE_MESSAGE);
		if (texts.some((text) => BARE.test(text))) warn(BARE_EXPRESSION_MESSAGE);
	}
	return issues;
}
