import { CODE_FIELDS } from "@fluxify/blocks/literalExpressions";

/**
 * `edit_code`: an exact find-and-replace inside one text field of a block, so
 * a one-line change does not resend a whole script.
 */

/** 1-based line of the character at `index` */
const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length;

const lineRange = (from: number, to: number) =>
	from === to ? `line ${from}` : `lines ${from}–${to}`;

/** where `old` starts: every match's line, for a message */
function matchLines(text: string, old: string) {
	const lines: number[] = [];
	for (let at = text.indexOf(old); at >= 0; at = text.indexOf(old, at + old.length)) {
		lines.push(lineAt(text, at));
	}
	return lines;
}

/** The lines around where the first line of `old` appears, when `old` as a whole does not. */
function nearby(text: string, old: string) {
	const first =
		old
			.split("\n")
			.find((l) => l.trim())
			?.trim() ?? "";
	const lines = text.split("\n");
	// the whole first line, then shorter starts of it: a near miss is usually a typo at the end
	let at = -1;
	for (let len = first.length; at < 0 && len >= Math.min(8, first.length) && len > 0; len -= 2) {
		at = lines.findIndex((l) => l.includes(first.slice(0, len)));
	}
	if (at < 0) return `The field has ${lines.length} line${lines.length === 1 ? "" : "s"}.`;
	const from = Math.max(0, at - 1);
	return `Closest text, line ${from + 1}:\n${lines.slice(from, at + 3).join("\n")}`;
}

/** The field edit_code works on: the one given, or the block's main code field. */
export function codeField(type: string, key: string, given?: string) {
	const field = given?.trim() || CODE_FIELDS[type];
	if (!field) {
		throw new Error(
			`edit_code: ${key} (${type}) has no code field of its own. Pass field, e.g. "url" for a js: text input.`,
		);
	}
	return field;
}

/**
 * The block's data with `old` replaced by `replacement` in `field`, and the
 * lines the new text now covers. Throws, saving nothing, unless `old` is found
 * exactly once.
 */
export function editCode(
	data: Record<string, unknown>,
	key: string,
	field: string,
	old: string,
	replacement: string,
) {
	const where = `${key}.${field}`;
	const text = data[field];
	if (typeof text !== "string") {
		throw new Error(
			`edit_code: ${where} is not a text field. Fields of ${key} holding text: ${
				Object.keys(data)
					.filter((k) => typeof data[k] === "string")
					.join(", ") || "none"
			}.`,
		);
	}
	if (!old) throw new Error("edit_code: old is empty. Give the exact text to replace.");
	const lines = matchLines(text, old);
	if (lines.length === 0) {
		throw new Error(
			`edit_code: the text in old was not found in ${where}. ${nearby(text, old)} Copy it exactly from get_canvas, including spaces and line breaks.`,
		);
	}
	if (lines.length > 1) {
		throw new Error(
			`edit_code: the text in old was found ${lines.length} times in ${where} (lines ${lines.join(", ")}). Add surrounding text to old so it matches once.`,
		);
	}
	const at = text.indexOf(old);
	const first = lineAt(text, at);
	return {
		data: { ...data, [field]: text.slice(0, at) + replacement + text.slice(at + old.length) },
		lines: lineRange(first, first + replacement.split("\n").length - 1),
	};
}
