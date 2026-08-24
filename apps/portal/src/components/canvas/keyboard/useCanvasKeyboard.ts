import { useEffect, useRef, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";
import { matchCombo } from "../actions/combo";
import type { CanvasAction } from "../actions/useCanvasActions";
import { useCanvasClipboard } from "../clipboard";

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Somewhere the user is typing: a form control, a rich text area, or a code
 * editor. Every shortcut yields to it — Ctrl+C there means copy the text.
 */
function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (EDITABLE_TAGS.has(target.tagName)) return true;
	if (target.isContentEditable) return true;
	return !!target.closest('[role="textbox"], .monaco-editor');
}

/**
 * An event belongs to this canvas when it came from inside its subtree, or from
 * nothing in particular (`body` — a fresh page where React Flow's pane has not
 * been clicked yet). Anything focused elsewhere is somebody else's event.
 */
function inCanvas(event: Event, root: HTMLElement | null): boolean {
	if (!root || isTypingTarget(event.target)) return false;
	const target = event.target;
	if (target === document.body || target === document) return true;
	return target instanceof Node && root.contains(target);
}

export type UseCanvasKeyboardOptions = {
	enabled: boolean;
	/** The canvas subtree. Shortcuts only fire for events originating inside it. */
	rootRef: RefObject<HTMLElement | null>;
	actions: CanvasAction[];
};

/**
 * Binds the canvas shortcuts.
 *
 * Bound on `document` rather than the canvas element, because React Flow's pane
 * only holds focus after a click — a fresh page would answer no shortcut at
 * all. The scope is restored explicitly instead: an event counts as ours when it
 * came from inside the canvas subtree, or from nothing in particular (`body`),
 * which is what keeps two canvases, or a canvas behind a modal, from both
 * reacting.
 *
 * Copy and paste ride the native `copy`/`paste` events rather than Ctrl+C/V, so
 * they work through the browser's own clipboard plumbing — no permission
 * prompt, and paste works in Firefox, where reading the clipboard from script
 * is not available at all.
 */
export function useCanvasKeyboard({
	enabled,
	rootRef,
	actions,
}: UseCanvasKeyboardOptions) {
	const { setNodes, setEdges } = useReactFlow();
	// Read through a ref so re-binding isn't needed on every selection change.
	const latest = useRef({ enabled, actions });
	latest.current = { enabled, actions };

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			// A held key repeating must not fire an action per frame.
			if (event.repeat) return;
			if (!latest.current.enabled || !inCanvas(event, rootRef.current)) return;
			if (matchCombo(event, "mod+a")) {
				event.preventDefault();
				setNodes((nodes) =>
					nodes.map((node) => (node.selected ? node : { ...node, selected: true })),
				);
				setEdges((edges) =>
					edges.map((edge) => (edge.selected ? edge : { ...edge, selected: true })),
				);
				return;
			}
			// Enter on a focused control activates that control — a block toolbar
			// button must not also open the settings panel.
			if (
				event.key === "Enter" &&
				event.target instanceof HTMLElement &&
				event.target.closest('button, a, [role="button"], [role="menuitem"]')
			) {
				return;
			}
			const action = latest.current.actions.find(
				(candidate) =>
					candidate.available &&
					candidate.combo &&
					// copy/paste are handled by their native events below.
					candidate.id !== "copy" &&
					candidate.id !== "paste" &&
					matchCombo(event, candidate.combo),
			);
			if (!action) return;
			// Claim the key even when the action can't run, so Ctrl+S never opens
			// the browser's save dialog on a canvas with nothing to save.
			event.preventDefault();
			if (!action.disabled) action.run();
		};

		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [rootRef]);

	const clipboard = useCanvasClipboard();
	const clipboardRef = useRef(clipboard);
	clipboardRef.current = clipboard;

	useEffect(() => {
		const inScope = (event: Event) =>
			latest.current.enabled &&
			clipboardRef.current.enabled &&
			inCanvas(event, rootRef.current);

		const onCopy = (event: ClipboardEvent) => {
			// Real text selected on the page — that is what the user meant to copy.
			if (!inScope(event) || window.getSelection()?.toString()) return;
			const { text } = clipboardRef.current.copy();
			if (!text) return;
			event.preventDefault();
			event.clipboardData?.setData("text/plain", text);
		};

		const onPaste = (event: ClipboardEvent) => {
			if (!inScope(event)) return;
			const text = event.clipboardData?.getData("text/plain");
			// Foreign clipboard content is left alone rather than swallowed.
			if (text && clipboardRef.current.pasteText(text)) event.preventDefault();
		};

		document.addEventListener("copy", onCopy);
		document.addEventListener("paste", onPaste);
		return () => {
			document.removeEventListener("copy", onCopy);
			document.removeEventListener("paste", onPaste);
		};
	}, [rootRef]);
}
