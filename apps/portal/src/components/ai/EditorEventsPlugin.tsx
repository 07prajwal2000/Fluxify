import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_HIGH, PASTE_COMMAND } from "lexical";
import { useEffect } from "react";
import { insertMarkdownAtSelection } from "./lexical/MarkdownTransformer";
import { INSERT_RESOURCE_COMMAND } from "./lexical/ResourcePlugin";

export function EditorEventsPlugin() {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		const insertHandler = (e: any) => {
			const { res, wasAtTyped } = e.detail;
			editor.focus();
			requestAnimationFrame(() => {
				const data = encodeURIComponent(JSON.stringify(res));
				editor.dispatchCommand(INSERT_RESOURCE_COMMAND, {
					resourceType: res.type,
					identifier: res.id,
					// a custom block's `name` is its namespaced runtime type
					// (`user_defined.project.notify`) — the label is what the
					// user called it
					name: res.label || res.name,
					data: data,
					replaceAt: wasAtTyped,
				});
			});
		};
		const focusHandler = () => {
			editor.focus();
		};

		const removePaste = editor.registerCommand(
			PASTE_COMMAND,
			(e: ClipboardEvent | InputEvent) => {
				let text = "";
				if (e instanceof ClipboardEvent) {
					text = e.clipboardData?.getData("text/plain") || "";
				}

				if (text && text.includes(":resource{")) {
					e.preventDefault();
					editor.update(() => {
						insertMarkdownAtSelection(text);
					});
					return true;
				}
				return false;
			},
			COMMAND_PRIORITY_HIGH,
		);

		document.addEventListener("insert-resource", insertHandler);
		document.addEventListener("focus-editor", focusHandler);

		return () => {
			document.removeEventListener("insert-resource", insertHandler);
			document.removeEventListener("focus-editor", focusHandler);
			removePaste();
		};
	}, [editor]);
	return null;
}
