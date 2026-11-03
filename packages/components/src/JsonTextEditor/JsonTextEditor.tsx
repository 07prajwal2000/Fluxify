import clsx from "clsx";
import { resolveTheme } from "../CodeViewer/CodeViewer";
import { MonacoEditor as Editor } from "../JavaScriptTextArea/monacoEditor";

export type JsonTextEditorProps = {
	/** The JSON text. The editor never rewrites it, so what you type is what you keep. */
	value: string;
	onChange: (text: string) => void;
	/** Editor height. Defaults to 160px. */
	height?: number | string;
	readOnly?: boolean;
	/** Draws the danger border; the message itself is the caller's to show. */
	invalid?: boolean;
	className?: string;
};

/**
 * An editable Monaco editor with the JSON language: syntax colours, brackets and
 * red underlines for a syntax error. `CodeViewer` is the read-only sibling; this
 * one hands back plain text and leaves parsing to the caller.
 */
export function JsonTextEditor({
	value,
	onChange,
	height = 160,
	readOnly = false,
	invalid = false,
	className,
}: JsonTextEditorProps) {
	return (
		<div
			className={clsx(
				"overflow-hidden rounded-md border",
				invalid ? "border-danger" : "border-border",
				className,
			)}
			// Monaco owns keyboard input; enclosing focus scopes would otherwise
			// swallow the keys that type, scroll and select inside it.
			onKeyDown={(event) => event.stopPropagation()}
		>
			<Editor
				height={height}
				language="json"
				theme={resolveTheme()}
				value={value}
				onChange={(text) => onChange(text ?? "")}
				options={{
					readOnly,
					minimap: { enabled: false },
					scrollBeyondLastLine: false,
					automaticLayout: true,
					fontSize: 12,
					lineNumbers: "off",
					lineDecorationsWidth: 8,
					folding: false,
					overviewRulerLanes: 0,
					padding: { top: 8, bottom: 8 },
					// EditContext focuses a plain div, which react-aria's Space handling
					// doesn't treat as a text field; the textarea fallback keeps Space typing.
					editContext: false,
				}}
			/>
		</div>
	);
}
