import { Modal } from "@heroui/react";
import { ExpressionEditor } from "./ExpressionEditor";

const MODAL_ROWS = 14;

export type LegacyExpressionModalProps = {
	isOpen: boolean;
	onClose: () => void;
	title: string;
	value: string;
	onChange: (value: string) => void;
	onSave: () => void;
};

export function LegacyExpressionModal({
	isOpen,
	onClose,
	title,
	value,
	onChange,
	onSave,
}: LegacyExpressionModalProps) {
	return (
		<Modal.Backdrop
			isOpen={isOpen}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<Modal.Container placement="center" size="md">
				<Modal.Dialog
					aria-label={title}
					className="p-4 rounded-xl border border-border bg-background"
				>
					<ExpressionEditor
						onCancel={onClose}
						onChange={onChange}
						onSave={onSave}
						rows={MODAL_ROWS}
						title={title}
						value={value}
					/>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
