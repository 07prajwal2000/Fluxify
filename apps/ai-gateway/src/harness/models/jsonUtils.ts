/**
 * Short, human-readable description of what a tool returned ("3 results"), so
 * the client can say *what* was found instead of just "tool finished".
 * Best-effort: an unrecognised shape simply yields nothing.
 */
export function summarizeToolResult(result: unknown): string | undefined {
	let value = result;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return undefined;
		}
	}
	const plural = (n: number, noun: string) =>
		`${n} ${noun}${n === 1 ? "" : "s"}`;

	if (Array.isArray(value)) return plural(value.length, "result");
	if (value && typeof value === "object") {
		for (const [key, entry] of Object.entries(value)) {
			if (Array.isArray(entry)) return plural(entry.length, key.replace(/s$/, ""));
		}
	}
	return undefined;
}

/**
 * Extracts the first complete JSON object/array, ignoring braces that appear
 * inside strings. `lastIndexOf("}")` guesses wrong whenever the model appends a
 * closing brace of its own (`\boxed{{...}}`, "…}. Let me know!"); this counts.
 * Returns null when there is no balanced value (no braces, or truncated output).
 */
export function sliceBalancedJson(text: string): string | null {
	const start = text.search(/[{[]/);
	if (start < 0) return null;

	const open = text[start];
	const close = open === "{" ? "}" : "]";
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (escaped) {
			escaped = false;
		} else if (char === "\\") {
			escaped = inString;
		} else if (char === '"') {
			inString = !inString;
		} else if (!inString) {
			if (char === open) depth++;
			else if (char === close && --depth === 0) return text.slice(start, i + 1);
		}
	}
	return null;
}

/**
 * `JSON.parse` with the two repairs that actually show up in the wild:
 * omitted-optional nulls, and payloads the model emitted double-escaped
 * (`{\"blocks\": []}` — the "Unrecognized token '\'" failure).
 */
export function parseJsonLoose(content: string): unknown {
	// `"field": null` for an omitted optional field is the single most common
	// drift; drop nulls so optional() accepts them.
	const dropNulls = (_key: string, value: any) =>
		value === null ? undefined : value;
	try {
		return JSON.parse(content, dropNulls);
	} catch (error) {
		// Only when the *payload itself* is escaped. `includes('\\"')` was too
		// loose: any block carrying JS (`return obj[\"key\"]`) matches it, so a
		// parse that failed for an unrelated reason had its escapes stripped and
		// came back as `JSON Parse error: Unexpected identifier "…"` — naming a
		// word from inside a string value rather than the actual problem.
		if (!/^[{[]\s*\\"/.test(content)) throw error;
		try {
			return JSON.parse(content.replace(/\\"/g, '"'), dropNulls);
		} catch {
			// The repair did not help; the first failure is the one worth reporting.
			throw error;
		}
	}
}

/** Compact, model-readable description of a zod or JSON parse failure. */
export function describeSchemaError(error: unknown): string {
	const issues = (error as any)?.issues;
	if (Array.isArray(issues)) {
		return issues
			.slice(0, 20)
			.map(
				(i: any) => `- ${(i.path ?? []).join(".") || "(root)"}: ${i.message}`,
			)
			.join("\n");
	}
	const message = error instanceof Error ? error.message : String(error);
	return message.slice(0, 500);
}

/**
 * Flattens a model response to plain text. Content can be a string, an array
 * of content blocks (Anthropic/Google/reasoning models), or empty with the
 * real text parked in a provider-specific `reasoning_content` field.
 */
export function extractText(response: {
	content: unknown;
	additional_kwargs?: Record<string, any>;
}): string {
	const { content } = response;
	let text = "";

	if (typeof content === "string") {
		text = content;
	} else if (Array.isArray(content)) {
		text = content
			.map((block: any) =>
				typeof block === "string" ? block : (block?.text ?? ""),
			)
			.join("");
	}

	if (!text.trim()) {
		// Reasoning models park their answer outside `content`: DeepSeek uses
		// `reasoning_content`, OpenRouter `reasoning`, Anthropic/Google a
		// thinking content block.
		const kwargs = response.additional_kwargs ?? {};
		const parked = [kwargs.reasoning_content, kwargs.reasoning].find(
			(v) => typeof v === "string" && v.trim(),
		);
		if (typeof parked === "string") text = parked;
		else if (Array.isArray(content)) {
			text = content
				.map((block: any) => block?.thinking ?? block?.reasoning ?? "")
				.join("");
		}
	}

	return text;
}

/** Strips think-blocks, markdown fences, quote-wrapping, and surrounding prose
 *  from a model's raw output, leaving just the JSON payload. */
export function cleanJsonOutput(content: string): string {
	// Remove <think>...</think> blocks from deepseek or reasoning models
	content = content.replace(/<think>[\s\S]*?<\/think>/g, "");

	// Remove markdown code blocks if present
	const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (codeBlockMatch && codeBlockMatch[1]) {
		content = codeBlockMatch[1];
	}

	content = content.trim();

	// Model returned the payload as a quoted JSON *string* ("{\"blocks\":[]}").
	// Unwrap before slicing, or the leading quote is cut and the escapes are left
	// behind as a stray backslash — "Unrecognized token '\'".
	if (content.startsWith('"') && content.endsWith('"')) {
		try {
			const inner = JSON.parse(content);
			if (typeof inner === "string") content = inner.trim();
		} catch {
			/* not a quoted string after all — carry on */
		}
	}

	// Strip any prose wrapped around the payload (e.g. "Here is the JSON: {...}").
	return (sliceBalancedJson(content) ?? content).trim();
}
