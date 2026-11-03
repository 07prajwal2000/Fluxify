import type { OnMount } from "@monaco-editor/react";

type Mounted = Parameters<OnMount>;

/**
 * Ctrl+S (Cmd+S) runs the current save (#1064). Bound even without one, so the
 * browser's own Save page dialog never opens from inside the editor.
 */
export function bindSaveShortcut(
	editor: Pick<Mounted[0], "addCommand">,
	monaco: {
		KeyMod: Pick<Mounted[1]["KeyMod"], "CtrlCmd">;
		KeyCode: Pick<Mounted[1]["KeyCode"], "KeyS">;
	},
	save: () => (() => void) | undefined,
) {
	editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save()?.());
}
