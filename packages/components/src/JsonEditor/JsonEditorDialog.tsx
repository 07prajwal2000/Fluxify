import { Button, Modal } from "@heroui/react";
import type { CSSProperties, ReactNode } from "react";
import { FiX } from "react-icons/fi";
import type { JsonEditorModalSize } from "./types";

interface JsonEditorDialogProps {
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	title: ReactNode;
	description?: ReactNode;
	icon?: ReactNode;
	children: ReactNode;
	footer: ReactNode;
	size: JsonEditorModalSize;
	width: CSSProperties["width"];
	height: CSSProperties["height"];
}

/**
 * JSON-editor-specific modal surface. Its fixed, viewport-safe dimensions keep
 * the dialog stable while nested collections expand and collapse.
 */
export function JsonEditorDialog({
	isOpen,
	onOpenChange,
	title,
	description,
	icon,
	children,
	footer,
	size,
	width,
	height,
}: JsonEditorDialogProps) {
	const accessibleTitle = typeof title === "string" ? title : "JSON editor";

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Container placement="center" scroll="inside" size={size}>
				<Modal.Dialog
					aria-label={accessibleTitle}
					className="flex max-h-[calc(100dvh_-_2rem)] max-w-[calc(100vw_-_2rem)] min-h-0 flex-col overflow-hidden rounded-xl p-4"
					style={{ width, height }}
				>
					<div className="flex min-h-7 shrink-0 items-center gap-2">
						{icon && (
							<span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius)] bg-accent-soft text-accent-soft-foreground">
								{icon}
							</span>
						)}
						<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
							{title}
						</span>
						<Button
							aria-label="Close JSON editor"
							className="h-7 w-7 min-w-7 p-0"
							isIconOnly
							onPress={() => onOpenChange(false)}
							size="sm"
							variant="ghost"
						>
							<FiX aria-hidden="true" className="size-4" />
						</Button>
					</div>

					{description && (
						<p className="mt-1 shrink-0 text-xs text-muted">{description}</p>
					)}

					<div className="my-3 min-h-0 flex-1 overflow-auto border-y border-border py-3">
						{children}
					</div>

					<div className="flex shrink-0 justify-end gap-2">{footer}</div>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
