import clsx from "clsx";
import { useId } from "react";
import { JsonEditorPanel } from "./JsonEditorPanel";
import type { JsonEditorInlineProps } from "./types";
import { useControllableJsonValue } from "./useControllableJsonValue";

export function JsonEditorInline({
	value,
	defaultValue,
	rootType,
	onChange,
	label = "JSON",
	description,
	errorMessage,
	isDisabled = false,
	isReadOnly = false,
	allowExpressions = true,
	showPreview = true,
	className,
}: JsonEditorInlineProps) {
	const labelId = useId();
	const descriptionId = useId();
	const errorId = useId();
	const [currentValue, setCurrentValue] = useControllableJsonValue({
		value,
		defaultValue,
		rootType,
		onChange,
	});

	return (
		<div
			aria-describedby={
				[description ? descriptionId : null, errorMessage ? errorId : null]
					.filter(Boolean)
					.join(" ") || undefined
			}
			aria-labelledby={label ? labelId : undefined}
			className={clsx("flex w-full flex-col gap-2.5", className)}
			role="group"
		>
			{label && (
				<span className="text-sm font-medium text-foreground" id={labelId}>
					{label}
				</span>
			)}
			{description && (
				<p className="text-xs text-muted" id={descriptionId}>
					{description}
				</p>
			)}
			<div
				className={clsx(
					"rounded-[var(--radius)] border bg-surface p-3",
					errorMessage ? "border-danger" : "border-border",
				)}
			>
				<JsonEditorPanel
					allowExpressions={allowExpressions}
					isReadOnly={isDisabled || isReadOnly}
					onChange={setCurrentValue}
					showPreview={showPreview}
					value={currentValue}
				/>
			</div>
			{errorMessage && (
				<p className="text-xs text-danger" id={errorId}>
					{errorMessage}
				</p>
			)}
		</div>
	);
}
