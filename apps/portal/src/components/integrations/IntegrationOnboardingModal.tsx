import { Modal } from "@fluxify/components";
import { IntegrationOnboardingForm } from "./IntegrationOnboardingForm";

type IntegrationOnboardingModalProps = {
	projectId: string;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
};

// This component only owns the dialog. The onboarding form can also be embedded elsewhere.
export function IntegrationOnboardingModal({ projectId, isOpen, onOpenChange }: IntegrationOnboardingModalProps) {
	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog className="w-full !max-w-2xl border border-[#1C202B] bg-[#0E1015]">
						<Modal.Header className="px-6 pb-2 pt-5">
							<Modal.Heading className="text-white">Connect an integration</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="px-6 pb-6 pt-1">
							{isOpen && <IntegrationOnboardingForm projectId={projectId} onSaved={() => onOpenChange(false)} />}
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
