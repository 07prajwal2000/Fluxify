import Editor from "@monaco-editor/react";
import clsx from "clsx";

export type CodeViewerProps = {
	value: string;
	/** Monaco language id — "json", "xml", "html", "plaintext"… */
	language?: string;
	/** Editor height. Defaults to 220px. */
	height?: number | string;
	showLineNumbers?: boolean;
	className?: string;
	/** Overrides the theme picked from the document. */
	theme?: string;
};

function resolveTheme(theme?: string) {
	if (theme) return theme;
	if (typeof document === "undefined") return "vs-dark";
	return document.documentElement.classList.contains("dark") ? "vs-dark" : "light";
}

/**
 * Read-only Monaco for showing a payload. `JavaScriptTextArea` is the editable,
 * JavaScript-only sibling; this one just renders text in whatever language it is
 * handed.
 */
export function CodeViewer({
	value,
	language = "plaintext",
	height = 220,
	showLineNumbers = false,
	className,
	theme,
}: CodeViewerProps) {
	return (
		<div
			className={clsx(
				"overflow-hidden rounded-[var(--radius)] border border-[var(--border)]",
				className,
			)}
			// Monaco owns keyboard input; enclosing focus scopes would otherwise
			// swallow the keys that scroll and select inside it.
			onKeyDown={(event) => event.stopPropagation()}
		>
			<Editor
				height={height}
				language={language}
				theme={resolveTheme(theme)}
				value={value}
				options={{
					readOnly: true,
					domReadOnly: true,
					minimap: { enabled: false },
					scrollBeyondLastLine: false,
					automaticLayout: true,
					fontSize: 12,
					lineNumbers: showLineNumbers ? "on" : "off",
					lineDecorationsWidth: 8,
					folding: false,
					overviewRulerLanes: 0,
					padding: { top: 8, bottom: 8 },
				}}
			/>
		</div>
	);
}
