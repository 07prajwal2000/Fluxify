import { CloseButton, Modal } from "@fluxify/components";
import { TriggerWizard } from "./TriggerWizard";
import type { TriggerListItem } from "@/services/triggers";

export function EditTriggerModal({
	projectId,
	trigger,
	onClose,
}: {
	projectId: string;
	trigger: TriggerListItem | null;
	onClose: () => void;
}) {
	return (
		<Modal isOpen={Boolean(trigger)} onOpenChange={(open) => !open && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" scroll="inside" size="cover" className="p-4 sm:p-6">
					<Modal.Dialog className="relative flex max-h-[92vh] w-[94vw] max-w-4xl flex-col overflow-y-auto rounded-xl border border-border bg-background p-6 shadow-2xl">
						<div className="absolute right-4 top-4 z-10">
							<CloseButton onPress={onClose} aria-label="Close edit trigger dialog" />
						</div>
						{trigger && (
							<TriggerWizard
								key={trigger.id}
								projectId={projectId}
								initialTrigger={trigger}
								onBack={onClose}
								onSuccess={onClose}
							/>
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
