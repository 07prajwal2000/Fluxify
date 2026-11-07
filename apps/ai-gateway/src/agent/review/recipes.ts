// The review recipes in docs/agents/review are the reviewer's rule set (#1081).
// Embedded at build time, so the bundled gateway needs no docs folder; the same
// pages are in the docs index, where search_docs and MCP clients find them.
import correctness from "../../../../../docs/agents/review/correctness.md" with { type: "text" };
import dataIntegrity from "../../../../../docs/agents/review/data-integrity.md" with {
	type: "text",
};
import errorHandling from "../../../../../docs/agents/review/error-handling.md" with {
	type: "text",
};
import index from "../../../../../docs/agents/review/index.md" with { type: "text" };
import performance from "../../../../../docs/agents/review/performance.md" with { type: "text" };
import schema from "../../../../../docs/agents/review/schema.md" with { type: "text" };
import security from "../../../../../docs/agents/review/security.md" with { type: "text" };
import testCoverage from "../../../../../docs/agents/review/test-coverage.md" with { type: "text" };

/** Frontmatter and doc links mean nothing to the reviewer: drop them, keep the link text. */
export const stripPage = (md: string) =>
	md
		.replace(/^---[\s\S]*?\n---\s*/, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.trim();

/** Index first (categories, severity, rules), then one recipe per category. */
export const REVIEW_RECIPES = [
	index,
	security,
	errorHandling,
	correctness,
	dataIntegrity,
	schema,
	performance,
	testCoverage,
]
	.map(stripPage)
	.join("\n\n");
