import { Button, CloseButton, Input, Label, Modal, TextField } from "@fluxify/components";
import { useState } from "react";

/**
 * One text box for a sandbox's name, for both Create and Rename. Mounted only
 * while open, so the box starts from `initialName` every time.
 */
export function SandboxNameDialog({
	title,
	confirmText,
	initialName = "",
	pending,
	onSubmit,
	onClose,
}: {
	title: string;
	confirmText: string;
	initialName?: string;
	pending: boolean;
	onSubmit: (name: string) => void;
	onClose: () => void;
}) {
	const [name, setName] = useState(initialName);
	const trimmed = name.trim();

	return (
		<Modal isOpen onOpenChange={(open) => !open && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center">
					<Modal.Dialog className="w-[26rem] max-w-[92vw]">
						<Modal.Header className="flex flex-row items-center gap-3">
							<Modal.Heading className="text-sm font-semibold">{title}</Modal.Heading>
							<CloseButton aria-label="Close" className="ml-auto" />
						</Modal.Header>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								if (trimmed && !pending) onSubmit(trimmed);
							}}
						>
							<Modal.Body>
								<TextField value={name} onChange={setName} autoFocus maxLength={255}>
									<Label>Name</Label>
									<Input placeholder="Try the orders query" />
								</TextField>
							</Modal.Body>
							<Modal.Footer className="flex flex-row items-center justify-end gap-2">
								<Button variant="ghost" onPress={onClose}>
									Cancel
								</Button>
								<Button type="submit" variant="primary" isDisabled={!trimmed} isPending={pending}>
									{confirmText}
								</Button>
							</Modal.Footer>
						</form>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
