import { Button } from "@heroui/react";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { TbBraces, TbDeviceFloppy } from "react-icons/tb";
import { JsonEditorDialog } from "./JsonEditorDialog";
import { JsonEditorPanel } from "./JsonEditorPanel";
import type { JsonContainer, JsonEditorModalProps } from "./types";
import { useControllableJsonValue } from "./useControllableJsonValue";

export function JsonEditorModal({
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
	triggerLabel = "Edit JSON",
	modalTitle,
	modalWidth = "min(72rem, calc(100vw - 2rem))",
	modalHeight = "min(46rem, calc(100dvh - 2rem))",
	modalSize = "cover",
	saveLabel = "Save",
	cancelLabel = "Cancel",
	isOpen: controlledOpen,
	defaultOpen = false,
	onOpenChange,
	onSave,
	triggerClassName,
}: JsonEditorModalProps) {
	const [currentValue, commitValue] = useControllableJsonValue({
		value,
		defaultValue,
		rootType,
		onChange,
	});
	const [internalOpen, setInternalOpen] = useState(defaultOpen);
	const [draft, setDraft] = useState<JsonContainer>(currentValue);
	const wasOpenRef = useRef(false);
	const isOpen = controlledOpen ?? internalOpen;
	const title = modalTitle ?? label ?? "JSON Editor";

	useEffect(() => {
		if (isOpen && !wasOpenRef.current) setDraft(currentValue);
		wasOpenRef.current = isOpen;
	}, [isOpen, currentValue]);

	const setOpen = useCallback(
		(nextOpen: boolean) => {
			if (controlledOpen === undefined) setInternalOpen(nextOpen);
			onOpenChange?.(nextOpen);
		},
		[controlledOpen, onOpenChange],
	);

	const save = () => {
		commitValue(draft);
		onSave?.(draft);
		setOpen(false);
	};

	return (
		<div className={clsx("inline-flex flex-col items-start gap-1.5", className)}>
			<Button
				className={triggerClassName}
				isDisabled={isDisabled}
				onPress={() => setOpen(true)}
				variant="secondary"
			>
				<TbBraces aria-hidden="true" className="size-4" />
				{triggerLabel}
			</Button>
			{errorMessage && <p className="text-xs text-danger">{errorMessage}</p>}
			<JsonEditorDialog
				description={description}
				footer={
					<>
						<Button
							className="h-7 px-3 text-xs font-medium"
							onPress={() => setOpen(false)}
							size="sm"
							variant="tertiary"
						>
							{isReadOnly ? "Close" : cancelLabel}
						</Button>
						{!isReadOnly && (
							<Button
								className="h-7 px-3 text-xs font-medium"
								isDisabled={isDisabled}
								onPress={save}
								size="sm"
								variant="primary"
							>
								<TbDeviceFloppy aria-hidden="true" className="size-4" />
								{saveLabel}
							</Button>
						)}
					</>
				}
				height={modalHeight}
				icon={<TbBraces aria-hidden="true" className="size-4" />}
				isOpen={isOpen}
				onOpenChange={setOpen}
				size={modalSize}
				title={title}
				width={modalWidth}
			>
				<JsonEditorPanel
					allowExpressions={allowExpressions}
					isReadOnly={isDisabled || isReadOnly}
					onChange={setDraft}
					showPreview={showPreview}
					value={draft}
				/>
			</JsonEditorDialog>
		</div>
	);
}
