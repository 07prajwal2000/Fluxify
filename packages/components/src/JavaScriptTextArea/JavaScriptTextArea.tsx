import Editor, { type OnMount } from "@monaco-editor/react";
import clsx from "clsx";
import { useCallback, useRef } from "react";
// Side-effect import: self-hosts Monaco and registers the JS language config.
import "./setup";

/** Monaco's own default; pinned so `rows` maps to an exact pixel height. */
const LINE_HEIGHT = 20;
const FONT_SIZE = 13;
/** Editor's own top/bottom padding, added on top of the line box. */
const VERTICAL_PADDING = 12;

export type JavaScriptTextAreaProps = {
	value?: string;
	defaultValue?: string;
	/** Called with the editor text — same shape as a controlled TextArea. */
	onChange?: (value: string) => void;
	/** Visible lines, exactly like a `<textarea rows>`. */
	rows?: number;
	readOnly?: boolean;
	autoFocus?: boolean;
	showLineNumbers?: boolean;
	/** Applied to the wrapper, so the usual sizing/spacing classes work. */
	className?: string;
	/** `"vs-dark" | "light"`. Follows the app theme when omitted. */
	theme?: string;
	"aria-label"?: string;
	onBlur?: () => void;
	onFocus?: () => void;
};

function resolveTheme(theme?: string) {
	if (theme) return theme;
	if (typeof document === "undefined") return "vs-dark";
	return document.documentElement.classList.contains("dark")
		? "vs-dark"
		: "light";
}

/**
 * A `<textarea>` that happens to be Monaco: JavaScript syntax, and autocomplete
 * for the Fluxify runtime globals. Sized by `rows` rather than by CSS so it
 * drops into a form where a plain textarea used to be.
 */
export function JavaScriptTextArea({
	value,
	defaultValue,
	onChange,
	rows = 4,
	readOnly,
	autoFocus,
	showLineNumbers = true,
	className,
	theme,
	onBlur,
	onFocus,
	"aria-label": ariaLabel,
}: JavaScriptTextAreaProps) {
	const height = rows * LINE_HEIGHT + VERTICAL_PADDING;
	const mountedRef = useRef(false);

	const onMount = useCallback<OnMount>(
		(editor, monaco) => {
			editor.onDidBlurEditorText(() => onBlur?.());
			editor.onDidFocusEditorText(() => onFocus?.());
			// Disable F1 Command Palette
			editor.addCommand(monaco.KeyCode.F1, () => {});
			if (autoFocus && !mountedRef.current) {
				mountedRef.current = true;
				editor.focus();
			}
		},
		[autoFocus, onBlur, onFocus],
	);

	return (
		// Monaco owns Tab for indentation. Without this, an enclosing focus scope
		// (popover/modal) steals the key and the user can't indent their code.
		<div
			aria-label={ariaLabel}
			className={clsx(
				"overflow-hidden rounded-[var(--radius)] border border-[var(--border)]",
				className,
			)}
			onKeyDown={(event) => {
				if (event.key === "Tab") event.stopPropagation();
			}}
		>
			<Editor
				defaultValue={defaultValue}
				height={height}
				language="javascript"
				onChange={(next) => onChange?.(next ?? "")}
				onMount={onMount}
				options={{
					readOnly,
					fontSize: FONT_SIZE,
					lineHeight: LINE_HEIGHT,
					lineNumbers: showLineNumbers ? "on" : "off",
					lineNumbersMinChars: 3,
					lineDecorationsWidth: 16,
					glyphMargin: false,
					minimap: { enabled: false },
					scrollBeyondLastLine: false,
					automaticLayout: true,
					padding: { top: 6, bottom: 6 },
					overviewRulerLanes: 0,
					folding: false,
					renderLineHighlight: "none",
					tabSize: 2,
					contextmenu: false,
				}}
				theme={resolveTheme(theme)}
				value={value}
			/>
		</div>
	);
}
