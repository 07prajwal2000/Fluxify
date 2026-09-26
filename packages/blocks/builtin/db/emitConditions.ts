import { type EmitNode, emitJsObject } from "../../compiler";
import { parseSqlTemplate } from "./rawCondition";
import type { DbSortEntry, WhereCondition } from "./schema";

/**
 * Where conditions become a plain JS array literal. `attribute` and `value` may
 * be js expressions, so those become inlined code; everything else is baked in
 * at compile time. The adapter still builds the SQL from the result — nothing
 * about knex changes.
 *
 * Both sides go through `emitJsObject`, not `node.value`: a side may be a
 * `{ kind: "column" | "literal" }` tag, and `node.value` JSON-stringifies any
 * non-string verbatim — so a `js:` expression *inside* a tag would ship to the
 * adapter as the literal text `"js:return …"` instead of being compiled.
 *
 * This lives outside `schema.ts` on purpose: every db block imports that module
 * for `adapterFor`/`dbFailure`, so a *value* import of the compiler there loads
 * the compiler before the schemas finish initialising and the block registry
 * fails with a TDZ error. `insert.ts` and `update.ts` import the compiler the
 * same way this file does.
 */
export function emitWhereConditions(conditions: WhereCondition[], node: EmitNode): string {
	const entries = conditions.map((condition) => {
		const chain = JSON.stringify(condition.chain);
		if ("group" in condition) {
			return `{ group: ${emitWhereConditions(condition.group, node)}, chain: ${chain} }`;
		}
		if (condition.operator === "raw") {
			return `{ operator: "raw", raw: ${emitRawCondition(condition.raw, node)}, chain: ${chain} }`;
		}
		return `{ attribute: ${emitJsObject(condition.attribute, node)}, operator: ${JSON.stringify(condition.operator)}, value: ${emitJsObject(condition.value, node)}, chain: ${chain} }`;
	});
	return `[${entries.join(", ")}]`;
}

/**
 * `js:` code (MongoDB) evaluates to the filter object it returns. Anything else
 * is SQL: the text is baked in, each `{{ }}` becomes a value evaluated in the
 * block's scope, and the adapter binds those as parameters.
 */
function emitRawCondition(raw: string, node: EmitNode) {
	if (raw.startsWith("js:")) return node.value(raw);
	const { strings, expressions } = parseSqlTemplate(raw);
	const values = expressions.map((expression) => node.js(`return (${expression});`, node.in));
	return `{ strings: ${JSON.stringify(strings)}, values: [${values.join(", ")}] }`;
}

/** the sort list as an array literal; each column may be a js expression */
export function emitSort(sort: DbSortEntry[], node: EmitNode): string {
	const entries = sort.map(
		(entry) =>
			`{ attribute: ${node.value(entry.attribute)}, direction: ${JSON.stringify(entry.direction)} }`,
	);
	return `[${entries.join(", ")}]`;
}
