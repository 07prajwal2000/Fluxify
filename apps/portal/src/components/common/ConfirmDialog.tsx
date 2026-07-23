import type { ReactNode } from "react";
import { Button, Modal } from "@fluxify/components";

type ConfirmDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	children?: ReactNode;
	confirmText?: string;
	cancelText?: string;
	danger?: boolean;
	pending?: boolean;
	onConfirm: () => void;
};

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	children,
	confirmText = "Confirm",
	cancelText = "Cancel",
	danger,
	pending,
	onConfirm,
}: ConfirmDialogProps) {
	return (
		<Modal isOpen={open} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header>
							<Modal.Heading>{title}</Modal.Heading>
						</Modal.Header>
						<Modal.Body>
							<div className="text-sm text-muted">{children}</div>
						</Modal.Body>
						<Modal.Footer>
							<Button variant="ghost" onPress={() => onOpenChange(false)}>
								{cancelText}
							</Button>
							<Button
								variant={danger ? "danger" : "primary"}
								isPending={pending}
								onPress={onConfirm}
							>
								{confirmText}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
