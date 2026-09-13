import { expect, test } from "bun:test";
import { comboLabel, matchCombo } from "./combo";

test("comboLabel renders formatted shortcut labels", () => {
	expect(comboLabel("mod+k")).toContain("K");
	expect(comboLabel("mod+space")).toContain("Space");
	expect(comboLabel("mod+shift+z")).toContain("Z");
	expect(comboLabel("enter")).toBe("Enter");
	expect(comboLabel("backspace")).toBe("Backspace");
});

test("matchCombo matches mod+k and mod+space shortcuts", () => {
	const kEvent = {
		key: "k",
		ctrlKey: true,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		code: "KeyK",
	} as unknown as KeyboardEvent;

	expect(matchCombo(kEvent, "mod+k")).toBe(true);
	expect(matchCombo(kEvent, "mod+space")).toBe(false);

	const spaceEvent = {
		key: " ",
		code: "Space",
		ctrlKey: true,
		metaKey: false,
		shiftKey: false,
		altKey: false,
	} as unknown as KeyboardEvent;

	expect(matchCombo(spaceEvent, "mod+space")).toBe(true);
	expect(matchCombo(spaceEvent, "mod+k")).toBe(false);
});
