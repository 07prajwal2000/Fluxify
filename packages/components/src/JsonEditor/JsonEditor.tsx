import { JsonEditorInline } from "./JsonEditorInline";
import { JsonEditorModal } from "./JsonEditorModal";
import type { JsonEditorProps } from "./types";

/**
 * Reusable structured JSON editor. Set `mode="modal"` for a draft-and-save
 * dialog, or omit it for a field-like inline editor with immediate changes.
 */
export function JsonEditor(props: JsonEditorProps) {
	if (props.mode === "modal") return <JsonEditorModal {...props} />;
	return <JsonEditorInline {...props} />;
}

