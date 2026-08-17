/**
 * Keyboard combos, written once and used twice: the keyboard layer matches
 * against them, the context menu prints them. A single string per action is
 * what stops the two from drifting.
 *
 * Grammar: `mod+shift+z` — modifiers `mod` (Ctrl, or Cmd on a Mac), `ctrl`,
 * `shift`, `alt`, followed by the key as `KeyboardEvent.key` in lower case
 * (`a`, `enter`, `delete`).
 */

export function isMac(): boolean {
	return typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);
}

type Parsed = { mod: boolean; ctrl: boolean; shift: boolean; alt: boolean; key: string };

function parse(combo: string): Parsed {
	const parts = combo.toLowerCase().split("+");
	return {
		mod: parts.includes("mod"),
		ctrl: parts.includes("ctrl"),
		shift: parts.includes("shift"),
		alt: parts.includes("alt"),
		key: parts[parts.length - 1] ?? "",
	};
}

/**
 * Exact match: every modifier must be in the state the combo asks for, so
 * `mod+z` never fires for `mod+shift+z`.
 */
export function matchCombo(event: KeyboardEvent, combo: string): boolean {
	const wanted = parse(combo);
	const primary = isMac() ? event.metaKey : event.ctrlKey;
	const secondary = isMac() ? event.ctrlKey : event.metaKey;
	if (wanted.mod !== primary) return false;
	if (wanted.ctrl !== secondary) return false;
	if (wanted.shift !== event.shiftKey) return false;
	if (wanted.alt !== event.altKey) return false;
	return event.key.toLowerCase() === wanted.key;
}

const KEY_LABELS: Record<string, string> = {
	enter: "Enter",
	delete: "Del",
	backspace: "Backspace",
	escape: "Esc",
	" ": "Space",
};

/** Printable form, platform aware: `⌘ ⇧ Z` on a Mac, `Ctrl + Shift + Z` elsewhere. */
export function comboLabel(combo: string): string {
	const { mod, ctrl, shift, alt, key } = parse(combo);
	const mac = isMac();
	const parts: string[] = [];
	if (mod) parts.push(mac ? "⌘" : "Ctrl");
	if (ctrl) parts.push(mac ? "⌃" : "Win");
	if (shift) parts.push(mac ? "⇧" : "Shift");
	if (alt) parts.push(mac ? "⌥" : "Alt");
	parts.push(KEY_LABELS[key] ?? key.toUpperCase());
	return parts.join(mac ? " " : " + ");
}
