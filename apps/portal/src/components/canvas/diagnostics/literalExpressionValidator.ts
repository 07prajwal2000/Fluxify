import { literalExpressionIssues } from "@fluxify/blocks/literalExpressions";
import type { CanvasGraph } from "../types";
import type { BlockDiagnostic } from "./types";

export const LITERAL_EXPRESSION_SOURCE = "literal-expression";

/** the shared `js:` check, as editor diagnostics */
export function validateLiteralExpressions(graph: CanvasGraph): BlockDiagnostic[] {
	return literalExpressionIssues(graph.blocks).map((issue) => ({
		...issue,
		source: LITERAL_EXPRESSION_SOURCE,
	}));
}
