import type z from "zod";
import { emitJsObject, type EmitNode } from "../../compiler";
import type { whereConditionSchema } from "./schema";

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
export function emitWhereConditions(
	conditions: z.infer<typeof whereConditionSchema>[],
	node: EmitNode,
) {
	const entries = conditions.map(
		(condition) =>
			`{ attribute: ${emitJsObject(condition.attribute, node)}, operator: ${JSON.stringify(condition.operator)}, value: ${emitJsObject(condition.value, node)}, chain: ${JSON.stringify(condition.chain)} }`,
	);
	return `[${entries.join(", ")}]`;
}
