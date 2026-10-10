import {
	Button,
	Checkbox,
	CloseButton,
	Input,
	Label,
	Modal,
	Spinner,
	TextField,
	toast,
} from "@fluxify/components";
import { useState } from "react";
import { showErrorNotification } from "@/lib/errorNotifier";
import { sandboxesQuery } from "@/query/sandboxesQuery";
import type { Sandbox } from "@/services/sandboxes";

/** A sandbox's name and its one setting: sending its spans to the project's OpenTelemetry destination. */
export function SandboxSettingsModal({
	projectId,
	sandboxId,
	isOpen,
	onOpenChange,
}: {
	projectId: string;
	sandboxId: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { data: sandbox, isLoading } = sandboxesQuery.byId.useQuery(projectId, sandboxId);

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center">
					<Modal.Dialog className="w-[30rem] max-w-[92vw]">
						<Modal.Header className="flex flex-row items-center gap-3">
							<Modal.Heading className="text-sm font-semibold">Sandbox settings</Modal.Heading>
							<CloseButton aria-label="Close settings" className="ml-auto" />
						</Modal.Header>
						{isLoading || !sandbox ? (
							<Modal.Body className="flex justify-center py-8">
								{isLoading ? <Spinner /> : <p className="text-sm text-muted">Sandbox not found.</p>}
							</Modal.Body>
						) : (
							// remounted per sandbox so every field starts from what the server holds
							<SettingsForm
								key={sandbox.id}
								projectId={projectId}
								sandbox={sandbox}
								onClose={() => onOpenChange(false)}
							/>
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

function SettingsForm({
	projectId,
	sandbox,
	onClose,
}: {
	projectId: string;
	sandbox: Sandbox;
	onClose: () => void;
}) {
	const [name, setName] = useState(sandbox.name);
	const [tracing, setTracing] = useState(sandbox.settings.tracingEnabled);
	const update = sandboxesQuery.update.mutation(projectId);
	const trimmed = name.trim();

	function save() {
		update.mutate(
			{ id: sandbox.id, body: { name: trimmed, settings: { tracingEnabled: tracing } } },
			{
				onSuccess: () => {
					toast.success("Sandbox saved");
					onClose();
				},
				onError: (error) => showErrorNotification(error),
			},
		);
	}

	return (
		<>
			<Modal.Body className="flex flex-col gap-4">
				<TextField value={name} onChange={setName} maxLength={255}>
					<Label>Name</Label>
					<Input />
				</TextField>
				<Checkbox
					isSelected={tracing}
					onChange={setTracing}
					label="Export traces (OpenTelemetry)"
					description="Send this sandbox's spans to the project's OpenTelemetry destination. Every run is recorded here whether this is on or off."
				/>
			</Modal.Body>
			<Modal.Footer className="flex flex-row items-center justify-end gap-2">
				<Button variant="ghost" onPress={onClose}>
					Cancel
				</Button>
				<Button variant="primary" isDisabled={!trimmed} isPending={update.isPending} onPress={save}>
					Save
				</Button>
			</Modal.Footer>
		</>
	);
}
