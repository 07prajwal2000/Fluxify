import { useState } from "react";
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
import { useNavigate } from "@tanstack/react-router";
import { workflowsQuery } from "@/query/workflowsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";

/**
 * Name it and go. A workflow has nothing else that must be decided up front —
 * the timeout and the switches are all better answered once
 * the canvas exists, so they live in its settings rather than in a wizard.
 */
export function CreateWorkflowModal({
	projectId,
	isOpen,
	onOpenChange,
}: {
	projectId: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const create = workflowsQuery.create.mutation();
	const navigate = useNavigate();
	const nameIsValid = name.trim().length >= 2;

	function submit() {
		create.mutate(
			{
				name: name.trim(),
				description: description.trim() || undefined,
				projectId,
				timeoutSeconds: 300,
			},
			{
				onSuccess: (result) => {
					toast.success("Workflow created");
					onOpenChange(false);
					navigate({
						to: "/$projectId/workflow-canvas/$workflowId",
						params: { projectId, workflowId: result.id },
					});
				},
				onError: (error) => showErrorNotification(error as Error),
			},
		);
	}

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center">
					<Modal.Dialog className="w-[32rem] max-w-[92vw]">
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading className="text-sm font-semibold">New workflow</Modal.Heading>
							<CloseButton aria-label="Close new workflow dialog" />
						</Modal.Header>

						<Modal.Body className="flex flex-col gap-4">
							<TextField
								isRequired
								autoFocus
								value={name}
								onChange={setName}
								isInvalid={name.length > 0 && !nameIsValid}
							>
								<Label>Name</Label>
								<Input placeholder="Nightly report" />
							</TextField>

							<div className="flex flex-col gap-1.5">
								<Label>Description</Label>
								<TextArea
									rows={3}
									placeholder="What this workflow does"
									value={description}
									onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
										setDescription(e.target.value)
									}
								/>
							</div>

							<p className="text-xs text-muted">
								It starts inactive with an entrypoint and an error handler. Build it, then
							activate it —
								an inactive workflow never runs.
							</p>
						</Modal.Body>

						<Modal.Footer className="flex flex-row items-center justify-end gap-2">
							<Button variant="ghost" onPress={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button
								variant="primary"
								isDisabled={!nameIsValid}
								isPending={create.isPending}
								onPress={submit}
							>
								Create workflow
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
