/**
 * Keys a NodeClaim manifest names projects and trigger groups by (#456):
 * `<project slug>/<group name>`. Both are set once and never change, so a
 * hand-written manifest keeps working. Lowercase letters, digits and inner
 * hyphens: DNS-safe, and no escaping in YAML or a URL.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 50;
export const SLUG_HINT = "lowercase letters, digits and hyphens, e.g. orders-api";

/** A best-effort slug from free text; empty when nothing usable is left. */
export function toSlug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, SLUG_MAX)
		.replace(/-+$/, "");
}
