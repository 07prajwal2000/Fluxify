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
				// clear of the vertical scrollbar
				className="absolute top-1 right-3 z-10 h-6 w-6 min-w-0 bg-surface/80 text-muted hover:text-foreground"
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
