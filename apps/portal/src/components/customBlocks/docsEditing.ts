/** New text plus the selection to restore after a toolbar action. */
export type Edit = { value: string; start: number; end: number };

/** `**bold**`-style: wrap the selection, keep it selected. */
export function wrapSelection(
	value: string,
	start: number,
	end: number,
	before: string,
	after: string,
): Edit {
	const text = value.slice(start, end);
	return {
		value: value.slice(0, start) + before + text + after + value.slice(end),
		start: start + before.length,
		end: start + before.length + text.length,
	};
}

/** `## ` at the start of the caret's line. */
export function prefixLine(value: string, caret: number, prefix: string): Edit {
	const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
	const pos = caret + prefix.length;
	return {
		value: value.slice(0, lineStart) + prefix + value.slice(lineStart),
		start: pos,
		end: pos,
	};
}

/** A `:::info` block around the selection, on lines of its own. */
export function insertBlock(
	value: string,
	start: number,
	end: number,
	open: string,
	close: string,
): Edit {
	const lead = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
	const trail = end < value.length && value[end] !== "\n" ? "\n" : "";
	return wrapSelection(value, start, end, lead + open, close + trail);
}
