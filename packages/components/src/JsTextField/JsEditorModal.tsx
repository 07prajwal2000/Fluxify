import { Modal } from "@heroui/react";
import type { editor as monacoEditor } from "monaco-editor";
import { useCallback, useMemo, useRef, useState } from "react";
import { CloseButton } from "../CloseButton";
import { JavaScriptTextArea } from "../JavaScriptTextArea";
import type { EditorTheme } from "./EditorSettingsMenu";
import {
	type CodeSnippet,
	DEFAULT_SNIPPETS,
	SnippetsSidebar,
	useRegisteredSnippets,
} from "./snippets";

export type JsEditorModalProps = {
	isOpen: boolean;
	onClose: () => void;
	title: string;
	value: string;
	onChange: (value: string) => void;
	onSave: () => void;
	snippets?: CodeSnippet[];
	readOnly?: boolean;
	typeDefinitions?: string;
};

export function JsEditorModal({
	isOpen,
	onClose,
	title,
	value,
	onChange,
	onSave,
	snippets: customSnippets,
	readOnly = false,
	typeDefinitions,
}: JsEditorModalProps) {
	const editorRef = useRef<monacoEditor.IStandaloneCodeEditor | null>(null);
	const [theme, setTheme] = useState<EditorTheme>("auto");
	const [wordWrap, setWordWrap] = useState(false);

	const registeredSnippets = useRegisteredSnippets();

	const allSnippets = useMemo(() => {
		const custom = customSnippets ?? [];
		const map = new Map<string, CodeSnippet>();

		for (const s of registeredSnippets) {
			map.set(s.id, s);
		}
		for (const s of custom) {
			map.set(s.id, s);
		}
		for (const s of DEFAULT_SNIPPETS) {
			if (!map.has(s.id)) {
				map.set(s.id, s);
			}
		}
		return Array.from(map.values());
	}, [registeredSnippets, customSnippets]);

	const handleInsertSnippet = useCallback(
		(snippetCode: string) => {
			if (readOnly) return;
			const editor = editorRef.current;
			if (!editor) {
				onChange(value ? `${value}\n\n${snippetCode}` : snippetCode);
				return;
			}

			const selection = editor.getSelection();
			if (selection) {
				editor.executeEdits("snippet-insert", [
					{
						range: selection,
						text: snippetCode,
						forceMoveMarkers: true,
					},
				]);
			} else {
				const model = editor.getModel();
				if (model) {
					const lineCount = model.getLineCount();
					const maxCol = model.getLineMaxColumn(lineCount);
					const needsNewline = model.getValue().trim().length > 0;
					editor.executeEdits("snippet-insert", [
						{
							range: {
								startLineNumber: lineCount,
								startColumn: maxCol,
								endLineNumber: lineCount,
								endColumn: maxCol,
							},
							text: needsNewline ? `\n\n${snippetCode}` : snippetCode,
							forceMoveMarkers: true,
						},
					]);
				}
			}
			editor.focus();
		},
		[readOnly, value, onChange],
	);

	return (
		<Modal.Backdrop
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Modal.Container
				placement="bottom"
				size="full"
				className="p-0 sm:p-0 md:p-0 flex items-end justify-center w-full"
			>
				<Modal.Dialog
					aria-label={title}
					className="p-0 overflow-hidden rounded-t-2xl rounded-b-none border-t border-x border-b-0 border-border bg-background shadow-2xl flex flex-col h-[50vh] min-h-[350px] max-h-[50vh] w-full max-w-5xl animate-in slide-in-from-bottom duration-200"
				>
					{/* Modal Header */}
					<div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-surface/50 shrink-0">
						<span className="text-sm font-semibold text-foreground truncate">{title}</span>
						<CloseButton onPress={onClose} />
					</div>

					{/* Modal Body: 2 Columns */}
					<div className="flex flex-1 min-h-0 overflow-hidden">
						{/* Left: Monaco Editor */}
						<div className="flex-1 min-w-0 p-3 flex flex-col bg-background h-full">
							<JavaScriptTextArea
								aria-label={title}
								autoFocus
								className="flex-1 h-full rounded-lg border border-border"
								height="100%"
								onChange={onChange}
								onEditorMount={(editor) => {
									editorRef.current = editor;
								}}
								readOnly={readOnly}
								theme={theme === "auto" ? undefined : theme}
								typeDefinitions={typeDefinitions}
								value={value}
								wordWrap={wordWrap}
							/>
						</div>

						{/* Right: Snippets Panel */}
						<SnippetsSidebar
							className="w-72 sm:w-80 shrink-0 h-full"
							onInsert={handleInsertSnippet}
							onSave={onSave}
							onThemeChange={setTheme}
							onWordWrapChange={setWordWrap}
							snippets={allSnippets}
							theme={theme}
							wordWrap={wordWrap}
						/>
					</div>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
