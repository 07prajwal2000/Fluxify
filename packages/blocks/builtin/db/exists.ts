import z from "zod";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";
import { emitGetSingleCall, getSingleDbBlockSchema } from "./getSingle";

// sort picks which row, and exists only asks whether there is one
export const existsDbBlockSchema = getSingleDbBlockSchema.omit({ sort: true });

export const existsDbAiDescription = {
	name: BlockTypes.db_exists,
	description:
		"Looks up a single record and branches on whether it exists. Same params as db_getsingle.",
	jsonSchema: JSON.stringify(z.toJSONSchema(existsDbBlockSchema)),
	handleInfo: `
Handles:
- 'success': a row matched. The block's output is that row (same shape db_getsingle returns).
- 'failure': no row matched. The output is the block's unchanged input.

Constraints:
- This block splits the flow. It does NOT have a 'source' handle.
- A database error is not 'failure'; it goes to the error handler.`,
};

/** a matching row takes `success` and becomes the output; no row keeps the input */
export function emitExistsDb(node: EmitNode) {
	const row = node.v("row");
	return `const ${row} = ${emitGetSingleCall(node)};
if (${row} != null) {
${node.in} = ${row};
${node.next("success")}
} else {
${node.next("failure")}
}`;
}
