import { Button, Checkbox, CloseButton, Modal, toast } from "@fluxify/components";
import { useState } from "react";
import { showErrorNotification } from "@/lib/errorNotifier";
import { type ResourceType, transferService } from "@/services/transfer";
import { capitalize, resourceOf } from "./resources";
import { bundleFilename, downloadBundle } from "./transferFile";

type ExportModalProps = {
	resourceType: ResourceType;
	/** what to export; the modal is open while this is set */
	resource: { id: string; name?: string | null } | null;
	onClose: () => void;
};

/** Asks whether the tests go in the file, then downloads it. */
export function ExportModal({ resourceType, resource, onClose }: ExportModalProps) {
	const { label, contents } = resourceOf(resourceType);
	const [includeTests, setIncludeTests] = useState(true);
	const [pending, setPending] = useState(false);

	const run = async () => {
		if (!resource) return;
		setPending(true);
		try {
			const bundle = await transferService.export(resourceType, resource.id, includeTests);
			downloadBundle(bundle, bundleFilename(resourceType, resource.name ?? ""));
			toast.success(`${capitalize(label)} exported`);
			onClose();
		} catch (error) {
			showErrorNotification(error as Error);
		} finally {
			setPending(false);
		}
	};

	return (
		<Modal isOpen={resource !== null} onOpenChange={(open) => !open && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>Export {label}</Modal.Heading>
							<CloseButton />
						</Modal.Header>
						<Modal.Body className="flex flex-col gap-3">
							<p className="text-sm text-muted">
								Exports {resource?.name ? `“${resource.name}”` : `the ${label}`} with its {contents}
								, so it can be imported into any project.
							</p>
							<Checkbox
								checked={includeTests}
								onChange={setIncludeTests}
								label="Include tests"
								description="Test suites, their assertions and block hooks. Secret values are never exported."
							/>
						</Modal.Body>
						<Modal.Footer>
							<Button variant="ghost" onPress={onClose}>
								Cancel
							</Button>
							<Button variant="primary" isPending={pending} onPress={run}>
								Export
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
