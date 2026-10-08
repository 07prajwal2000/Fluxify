import type z from "zod";
import { blockName } from "./baseBlock";
import { BlockTypes } from "./blockTypes";
import { builtinBlockSchemas } from "./builtin/blockSchemasMap";

/**
 * A block whose `data` does not match its schema still saves (a canvas being
 * built may be half done), but it comes back as a warning naming the field, so
 * the mistake shows at save instead of at compile or run time.
 */
export type BlockDataIssue = { blockId: string; severity: "warning"; message: string };

const BUILTIN = new Set<string>(Object.values(BlockTypes));

/** the data schema of a built-in block type; undefined for a custom block */
export function blockDataSchema(type: string): z.ZodTypeAny | undefined {
	if (!BUILTIN.has(type)) return undefined;
	return builtinBlockSchemas[type.replace(/_/g, "").toLowerCase()];
}

type Issue = {
	code: string;
	path: PropertyKey[];
	message: string;
	expected?: string;
	values?: unknown[];
	options?: unknown[];
	errors?: Issue[][];
};

const isMissing = (issue: Issue) =>
	issue.code === "invalid_type" && issue.message.endsWith("received undefined");

/**
 * The union member the data was most likely meant to be: a member that needs
 * fields the data does not have at all is a poor guess, so missing fields cost
 * more than wrong ones.
 */
function closestBranch(branches: Issue[][]): Issue[] {
	const cost = (branch: Issue[]) =>
		branch.reduce((sum, issue) => sum + (isMissing(issue) ? 10 : 1), 0);
	return branches.reduce((best, branch) => (cost(branch) < cost(best) ? branch : best));
}

/** union issues replaced by the issues of their closest member, paths made absolute */
function leaves(issues: Issue[], prefix: PropertyKey[] = []): Issue[] {
	return issues.flatMap((issue) => {
		const path = [...prefix, ...issue.path];
		if (issue.code === "invalid_union" && issue.errors?.length)
			return leaves(closestBranch(issue.errors), path);
		return [{ ...issue, path }];
	});
}

const article = (word: string) => (/^[aeiou]/.test(word) ? `an ${word}` : `a ${word}`);
const listOf = (values: unknown[]) =>
	values.filter((v) => v !== null && v !== undefined).join(", ");

function describe(issue: Issue): string {
	if (isMissing(issue)) return "is required";
	if (issue.code === "invalid_type" && issue.expected) return `must be ${article(issue.expected)}`;
	if (issue.code === "invalid_value" && issue.values)
		return issue.values.length === 1
			? `must be ${JSON.stringify(issue.values[0])}`
			: `must be one of ${listOf(issue.values)}`;
	if (issue.code === "invalid_union" && issue.options)
		return `must be one of ${listOf(issue.options)}`;
	return issue.message;
}

/** `conditions[0].operator` */
function fieldPath(path: PropertyKey[]): string {
	return (
		path
			.map((key, i) => (typeof key === "number" ? `[${key}]` : i ? `.${String(key)}` : String(key)))
			.join("") || "data"
	);
}

/** One warning per mistake in each built-in block's data. Custom blocks are skipped. */
export function blockDataIssues(
	blocks: { id: string; type: string | null; data?: unknown }[],
): BlockDataIssue[] {
	return blocks.flatMap((block) => {
		const schema = blockDataSchema(block.type ?? "");
		if (!schema) return [];
		const result = schema.safeParse(block.data ?? {});
		if (result.success) return [];
		const name = blockName(block.data);
		const label = name ? `${block.type} "${name}"` : block.type;
		return leaves(result.error.issues as Issue[]).map((issue) => ({
			blockId: block.id,
			severity: "warning" as const,
			message: `${label}: ${fieldPath(issue.path)} ${describe(issue)}`,
		}));
	});
}
