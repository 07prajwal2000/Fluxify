/** What the extra-body editor's text means: the object to save, or why it cannot be saved yet. */
export type ExtraBodyParse = { body: Record<string, unknown> } | { error: string };

/** Blank text is an empty body; anything else must be a JSON object (not an array, string or null). */
export function parseExtraBody(text: string): ExtraBodyParse {
	if (!text.trim()) return { body: {} };
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return { error: "Not valid JSON yet. The last valid body is kept until this parses." };
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		return { error: 'Must be a JSON object, like { "reasoning_effort": "low" }' };
	return { body: value as Record<string, unknown> };
}
