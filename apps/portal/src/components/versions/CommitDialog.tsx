import {
	Button,
	CloseButton,
	Input,
	Label,
	Modal,
	TextArea,
	TextField,
	toast,
} from "@fluxify/components";
import { useState } from "react";
import { showErrorNotification } from "@/lib/errorNotifier";
import { versionsQuery } from "@/query/versionsQuery";
import type { VersionKind } from "@/services/versions";

/**
 * Names the work being saved as the next version (#738). Mounted only while
 * open, so the boxes start empty every time.
 */
export function CommitDialog({
	kind,
	id,
	saveFirst,
	onClose,
}: {
	kind: VersionKind;
	id: string;
	/** the canvas has edits no save holds: saves them, and says whether it did */
	saveFirst?: () => Promise<boolean>;
	onClose: () => void;
}) {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [saving, setSaving] = useState(false);
	const commit = versionsQuery.commit.mutation(kind, id);
	const trimmed = title.trim();

	async function submit() {
		if (!trimmed || commit.isPending || saving) return;
		if (saveFirst) {
			setSaving(true);
			const saved = await saveFirst().finally(() => setSaving(false));
			// a save that failed has said why; the work stays here to try again
			if (!saved) return;
		}
		commit.mutate(
			{ title: trimmed, description: description.trim() || undefined },
			{
				onSuccess: (version) => {
					toast.success(`Committed v${version.versionNumber}`);
					onClose();
				},
				onError: (error) => showErrorNotification(error),
			},
		);
	}

	return (
		<Modal isOpen onOpenChange={(open) => !open && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center">
					<Modal.Dialog className="w-[28rem] max-w-[92vw]">
						<Modal.Header className="flex flex-row items-center gap-3">
							<Modal.Heading className="text-sm font-semibold">Commit a version</Modal.Heading>
							<CloseButton aria-label="Close" className="ml-auto" />
						</Modal.Header>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void submit();
							}}
						>
							<Modal.Body className="flex flex-col gap-3">
								<p className="text-xs text-muted">
									Saves the {kind} as it is now, to come back to later. It does not deploy anything.
								</p>
								{saveFirst && (
									<p className="text-xs text-muted">
										This canvas has changes that are not saved yet. A version holds what is saved,
										so they are saved first.
									</p>
								)}
								<TextField isRequired value={title} onChange={setTitle} autoFocus maxLength={255}>
									<Label>Title</Label>
									<Input placeholder="Add rate limiting" />
								</TextField>
								<TextField value={description} onChange={setDescription} maxLength={5000}>
									<Label>Description (optional)</Label>
									<TextArea rows={3} />
								</TextField>
							</Modal.Body>
							<Modal.Footer className="flex flex-row items-center justify-end gap-2">
								<Button variant="ghost" onPress={onClose}>
									Cancel
								</Button>
								<Button
									type="submit"
									variant="primary"
									isDisabled={!trimmed}
									isPending={commit.isPending || saving}
								>
									{saveFirst ? "Save and commit" : "Commit"}
								</Button>
							</Modal.Footer>
						</form>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
