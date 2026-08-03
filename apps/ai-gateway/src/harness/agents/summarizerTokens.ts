import { logger } from "@fluxify/common";

/** Reference tokens the summarizer may only ever copy, never author. */
const REFERENCE_TOKEN = /:(?:route|canvasChanges)\{[^}\n]*\}/gi;

/**
 * Keeps only the reference tokens the harness actually handed the summarizer.
 *
 * The frontend renders these as buttons that open a stored artifact, so a
 * token the model invented — or copied from a block description that asked it
 * to — shows the user a chip claiming work that never happened, or pointing at
 * an artifact from another change. The prompt says "copy verbatim"; this is
 * what makes that true, because the harness knows the exact legitimate set and
 * the model does not need to be trusted with it.
 *
 * Anything unrecognised is dropped and the surrounding sentence left intact —
 * a summary line without its chip still reads correctly, a wrong chip does not.
 * Repeats are dropped too: one token per change, or two buttons open the same
 * artifact and one change silently loses its own.
 */
export function enforceTokenAllowlist(
	markdown: string,
	allowed: string[],
): string {
	const permitted = new Set(allowed);
	const used = new Set<string>();
	const rejected: string[] = [];

	const cleaned = markdown.replace(REFERENCE_TOKEN, (token) => {
		if (!permitted.has(token) || used.has(token)) {
			rejected.push(token);
			return "";
		}
		used.add(token);
		return token;
	});

	if (rejected.length > 0) {
		logger.warn("[Summarizer] Dropped tokens the harness did not issue", {
			rejected,
			allowed,
		});
	}

	// Only tidy up what removing a token left behind: trailing spaces before a
	// newline, and lines that were nothing but a token.
	return cleaned
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
