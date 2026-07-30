import { useState, useEffect } from "react";
import { Button, Modal, Input, TextField, Label } from "@fluxify/components";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	conversationId: string;
	initialTitle: string;
};

export function RenameConversationModal({
	open,
	onOpenChange,
	projectId,
	conversationId,
	initialTitle,
}: Props) {
	const [title, setTitle] = useState(initialTitle);
	const update = harnessConversationsQuery.update.mutation(projectId, conversationId);

	// Reset state when modal opens
	useEffect(() => {
		if (open) {
			setTitle(initialTitle);
		}
	}, [open, initialTitle]);

	const handleSave = () => {
		const newTitle = title.trim();
		if (!newTitle) return;
		update.mutate(
			{ title: newTitle },
			{
				onSuccess: () => {
					onOpenChange(false);
				},
				onError: (err: any) => {
					showErrorNotification(err.message || "Failed to rename conversation");
				},
			}
		);
	};

	return (
		<Modal isOpen={open} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header>
							<Modal.Heading>Rename conversation</Modal.Heading>
						</Modal.Header>
						<Modal.Body>
							<div className="py-2">
								<TextField 
									value={title} 
									onChange={setTitle}
									autoFocus
									onKeyDown={(e: any) => {
										if (e.key === "Enter") handleSave();
									}}
								>
									<Label className="sr-only">Conversation title</Label>
									<Input placeholder="e.g. Database schema setup" />
								</TextField>
							</div>
						</Modal.Body>
						<Modal.Footer>
							<Button variant="ghost" onPress={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button
								variant="primary"
								isPending={update.isPending}
								onPress={handleSave}
								isDisabled={!title.trim() || title.trim() === initialTitle}
							>
								Save
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
