import { Modal } from "@fluxify/components";

type Props = {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
};

/** Documents the special syntax supported in the chat prompt.
 *  Body intentionally empty for now — content lands in a later pass. */
export function SyntaxHelpModal({ isOpen, onOpenChange }: Props) {
	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="md">
					<Modal.Dialog>
						<Modal.Header>
							<Modal.Heading>Prompt syntax</Modal.Heading>
							<p className="mt-1 text-sm text-muted">
								Special syntax you can use in your message.
							</p>
						</Modal.Header>
						<Modal.Body>
							<div className="py-8 text-center text-sm text-muted">
								Coming soon.
							</div>
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
