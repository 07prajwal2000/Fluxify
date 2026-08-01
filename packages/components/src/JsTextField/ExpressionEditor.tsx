import { Button } from "@heroui/react";
import type { ReactNode } from "react";
import { JavaScriptTextArea } from "../JavaScriptTextArea";

export type ExpressionEditorProps = {
	/** Same text in the popover and the modal, so expanding feels continuous. */
	title: string;
	value: string;
	onChange: (value: string) => void;
	rows: number;
	/** Icon button placed before the title or after it. */
	leading?: ReactNode;
	trailing?: ReactNode;
	onCancel: () => void;
	onSave: () => void;
};

/**
 * The body shared by the popover and the modal: heading, editor, actions. Both
 * surfaces render this so the only difference between them is their size.
 */
export function ExpressionEditor({
	title,
	value,
	onChange,
	rows,
	leading,
	trailing,
	onCancel,
	onSave,
}: ExpressionEditorProps) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-1.5 min-h-6">
				{leading}
				<span className="text-xs font-medium text-muted">{title}</span>
				<span className="flex-1" />
				{trailing}
			</div>
			<JavaScriptTextArea
				aria-label={title}
				autoFocus
				className="flex-1"
				onChange={onChange}
				rows={rows}
				value={value}
			/>
			<div className="flex justify-end gap-2 pt-1">
				<Button
					className="h-7 px-3 text-xs font-medium"
					size="sm"
					variant="tertiary"
					onPress={onCancel}
				>
					Cancel
				</Button>
				<Button
					className="h-7 px-3 text-xs font-medium"
					size="sm"
					variant="primary"
					onPress={onSave}
				>
					Save Expression
				</Button>
			</div>
		</div>
	);
}
