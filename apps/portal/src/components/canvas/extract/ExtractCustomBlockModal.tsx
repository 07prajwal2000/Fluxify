import { Button, Checkbox, CloseButton, Input, Label, Modal, TextField } from "@fluxify/components";
import { useEffect, useState } from "react";

export type ExtractInput = { name: string; label: string; replace: boolean };

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	blockCount: number;
	isPending: boolean;
	onSubmit: (input: ExtractInput) => void;
};

/** `Verify JWT` → `verify_jwt`: the name a custom block may carry. */
export const nameFromLabel = (label: string) =>
	label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");

/** Asks for the label and name of the block being extracted from the selection. */
export function ExtractCustomBlockModal({
	open,
	onOpenChange,
	blockCount,
	isPending,
	onSubmit,
}: Props) {
	const [label, setLabel] = useState("");
	const [name, setName] = useState("");
	const [nameEdited, setNameEdited] = useState(false);
	const [replace, setReplace] = useState(false);

	useEffect(() => {
		if (!open) return;
		setLabel("");
		setName("");
		setNameEdited(false);
		setReplace(false);
	}, [open]);

	const valid = label.trim() !== "" && /^[a-z0-9_]+$/.test(name);
	const submit = () => valid && onSubmit({ name, label: label.trim(), replace });

	return (
		<Modal isOpen={open} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>Extract to custom block</Modal.Heading>
							<CloseButton />
						</Modal.Header>
						<Modal.Body>
							<div className="flex flex-col gap-3 py-2">
								<p className="text-sm text-muted">
									{blockCount} selected block{blockCount === 1 ? "" : "s"} become a custom block you
									can reuse in other routes.
								</p>
								<TextField
									value={label}
									autoFocus
									onChange={(value) => {
										setLabel(value);
										if (!nameEdited) setName(nameFromLabel(value));
									}}
									onKeyDown={(e: { key: string }) => e.key === "Enter" && submit()}
								>
									<Label>Label</Label>
									<Input placeholder="e.g. Verify JWT" />
								</TextField>
								<TextField
									value={name}
									onChange={(value) => {
										setName(value);
										setNameEdited(true);
									}}
									onKeyDown={(e: { key: string }) => e.key === "Enter" && submit()}
								>
									<Label>Name</Label>
									<Input placeholder="verify_jwt" />
								</TextField>
								<Checkbox
									isSelected={replace}
									onChange={setReplace}
									label="Replace the selection with the new block"
								/>
							</div>
						</Modal.Body>
						<Modal.Footer>
							<Button variant="ghost" onPress={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button variant="primary" isPending={isPending} isDisabled={!valid} onPress={submit}>
								Extract
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
