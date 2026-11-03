import { describe, expect, it, mock } from "bun:test";
import { bindSaveShortcut } from "./saveShortcut";

const monaco = { KeyMod: { CtrlCmd: 2048 }, KeyCode: { KeyS: 49 } };

function bound(save: () => (() => void) | undefined) {
	const commands = new Map<number, () => void>();
	bindSaveShortcut(
		{ addCommand: (keybinding: number, handler: () => void) => commands.set(keybinding, handler) && null },
		monaco,
		save,
	);
	return commands.get(2048 | 49);
}

describe("bindSaveShortcut", () => {
	it("runs the save that is current when Ctrl+S is pressed", () => {
		let current = mock(() => {});
		const command = bound(() => current);
		const later = mock(() => {});
		current = later;
		command?.();
		expect(later).toHaveBeenCalledTimes(1);
	});

	it("binds Ctrl+S even when there is nothing to save", () => {
		const command = bound(() => undefined);
		expect(command).toBeDefined();
		expect(() => command?.()).not.toThrow();
	});
});
