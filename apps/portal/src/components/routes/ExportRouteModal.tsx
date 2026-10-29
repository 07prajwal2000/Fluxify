import { Button, Checkbox, CloseButton, Modal, toast } from "@fluxify/components";
import { useState } from "react";
import { showErrorNotification } from "@/lib/errorNotifier";
import { routesService } from "@/services/routes";
import { downloadRouteFile, routeFilename } from "./routeFile";

type ExportRouteModalProps = {
	/** the route to export; the modal is open while this is set */
	route: { id: string; name?: string | null } | null;
	onClose: () => void;
};

/** Asks whether the route's tests go in the file, then downloads it. */
export function ExportRouteModal({ route, onClose }: ExportRouteModalProps) {
	const [includeTests, setIncludeTests] = useState(true);
	const [pending, setPending] = useState(false);

	const run = async () => {
		if (!route) return;
		setPending(true);
		try {
			const bundle = await routesService.export(route.id, includeTests);
			downloadRouteFile(bundle, routeFilename(route.name ?? ""));
			toast.success("Route exported");
			onClose();
		} catch (error) {
			showErrorNotification(error as Error);
		} finally {
			setPending(false);
		}
	};

	return (
		<Modal isOpen={route !== null} onOpenChange={(open) => !open && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>Export route</Modal.Heading>
							<CloseButton />
						</Modal.Header>
						<Modal.Body className="flex flex-col gap-3">
							<p className="text-sm text-muted">
								Exports {route?.name ? `“${route.name}”` : "the route"} with its settings, blocks
								and response schemas, so it can be imported into any project.
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
