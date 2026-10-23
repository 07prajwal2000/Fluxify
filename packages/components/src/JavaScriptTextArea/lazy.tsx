import { Button } from "@heroui/react";
import { lazy, Suspense, useState } from "react";
import { TbArrowsMaximize } from "react-icons/tb";
import { JsEditorModal } from "../JsTextField/JsEditorModal";
import type { JavaScriptTextAreaProps } from "./JavaScriptTextArea";

/**
 * Monaco is ~2MB and touches `window` at import time. Loading it lazily keeps it
 * out of the initial bundle — and out of every module that merely imports
 * something else from this package's barrel.
 */
const Editor = lazy(async () => ({
	default: (await import("./JavaScriptTextArea")).JavaScriptTextArea,
}));

export function JavaScriptTextArea({
	expandable,
	expandTitle = "Code Editor",
	...props
}: JavaScriptTextAreaProps) {
	const [isExpanded, setIsExpanded] = useState(false);
	const editor = (
		<Suspense fallback={<div className={props.className} />}>
			<Editor {...props} />
		</Suspense>
	);
	if (!expandable) return editor;

	return (
		<div className="relative">
			{editor}
			<Button
				isIconOnly
				size="sm"
				variant="ghost"
				aria-label="Expand code editor"
				// inside the editor's top-right corner, clear of its 8px vertical scrollbar (#950)
				className="absolute top-1.5 right-3 z-10 size-6 min-w-0 rounded-md border border-border bg-surface/90 text-muted backdrop-blur-sm hover:bg-surface-secondary hover:text-foreground"
				onPress={() => setIsExpanded(true)}
			>
				<TbArrowsMaximize className="size-3.5" />
			</Button>
			{isExpanded && (
				<JsEditorModal
					isOpen
					onClose={() => setIsExpanded(false)}
					onSave={() => setIsExpanded(false)}
					title={expandTitle}
					value={props.value ?? ""}
					onChange={(next) => props.onChange?.(next)}
					readOnly={props.readOnly}
					typeDefinitions={props.typeDefinitions}
				/>
			)}
		</div>
	);
}
