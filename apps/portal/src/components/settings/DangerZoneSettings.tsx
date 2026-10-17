import {
	Button,
	CloseButton,
	DeleteButton,
	Input,
	Label,
	Modal,
	TextField,
	toast,
} from "@fluxify/components";
import { useState } from "react";
import { TbAlertTriangle } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import { projectsQuery } from "@/query/projectsQuery";

/** Only rendered for system admins (the settings tab is gated); the server refuses anyone else. */
export function DangerZoneSettings({
	projectId,
	onDeleted,
}: {
	projectId: string;
	onDeleted: () => void;
}) {
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	const [open, setOpen] = useState(false);

	return (
		<div className="rounded-xl border border-danger/30 bg-danger/10 p-6">
			<div className="flex items-center gap-2 text-danger">
				<TbAlertTriangle size={20} />
				<h2 className="text-lg font-medium tracking-tight">Danger Zone</h2>
			</div>
			<p className="mt-2 text-sm text-muted">
				Delete project removes its routes, workflows, triggers, custom blocks, integrations,
				settings, members and recordings. Running triggers stop. This can't be undone.
			</p>
			<div className="mt-6">
				<DeleteButton isDisabled={!project} onPress={() => setOpen(true)}>
					Delete project
				</DeleteButton>
			</div>
			{project ? (
				<DeleteProjectDialog
					open={open}
					onOpenChange={setOpen}
					projectId={projectId}
					projectName={project.name ?? ""}
					onDeleted={onDeleted}
				/>
			) : null}
		</div>
	);
}

/** The user types the project's name before the delete button is enabled. */
function DeleteProjectDialog({
	open,
	onOpenChange,
	projectId,
	projectName,
	onDeleted,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	projectName: string;
	onDeleted: () => void;
}) {
	const [typed, setTyped] = useState("");
	const remove = projectsQuery.remove.mutation();
	const matches = typed === projectName;

	function close(next: boolean) {
		if (!next) setTyped("");
		onOpenChange(next);
	}

	function handleDelete() {
		if (!matches || remove.isPending) return;
		remove.mutate(projectId, {
			onSuccess: () => {
				toast.success(`Deleted ${projectName}`);
				onDeleted();
			},
			onError: (e) => showErrorNotification(e as Error),
		});
	}

	return (
		<Modal isOpen={open} onOpenChange={close}>
			<Modal.Backdrop>
				<Modal.Container placement="center">
					<Modal.Dialog className="w-[28rem] max-w-[92vw]">
						<Modal.Header className="flex flex-row items-center gap-3">
							<Modal.Heading className="text-sm font-semibold">Delete project?</Modal.Heading>
							<CloseButton aria-label="Close" className="ml-auto" />
						</Modal.Header>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								handleDelete();
							}}
						>
							<Modal.Body>
								<div className="flex flex-col gap-3 text-sm text-muted">
									<p>
										This removes everything in the project and can't be undone. Type{" "}
										<b className="text-foreground">{projectName}</b> to confirm.
									</p>
									<TextField value={typed} onChange={setTyped} autoFocus>
										<Label>Project name</Label>
										<Input placeholder={projectName} />
									</TextField>
								</div>
							</Modal.Body>
							<Modal.Footer className="flex flex-row items-center justify-end gap-2">
								<Button variant="ghost" onPress={() => close(false)}>
									Cancel
								</Button>
								<Button
									type="submit"
									variant="danger-soft"
									isDisabled={!matches}
									isPending={remove.isPending}
								>
									Delete project
								</Button>
							</Modal.Footer>
						</form>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
