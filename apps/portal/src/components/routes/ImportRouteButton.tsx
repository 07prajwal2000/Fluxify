import { Button, CloseButton, Modal, toast } from "@fluxify/components";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { TbFileImport } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import { routesQuery } from "@/query/routesQuery";
import { pickRouteFile, readRouteFile } from "./routeFile";

/** Picks an exported route file and creates the route (and its tests) from it. */
export function ImportRouteButton({ projectId }: { projectId: string }) {
	const navigate = useNavigate();
	const importRoute = routesQuery.import.mutation();
	// set when the import left something out: the user reads it before opening the route
	const [result, setResult] = useState<{ id: string; warnings: string[] } | null>(null);

	const open = (routeId: string) =>
		navigate({ to: "/$projectId/canvas/$routeId", params: { projectId, routeId } });

	const run = async () => {
		const file = await pickRouteFile();
		if (!file) return;
		try {
			const bundle = await readRouteFile(file);
			const done = await importRoute.mutateAsync({ projectId, bundle });
			if (done.warnings.length > 0) return setResult(done);
			toast.success("Route imported");
			open(done.id);
		} catch (error) {
			showErrorNotification(error as Error);
		}
	};

	return (
		<>
			<Button variant="outline" isPending={importRoute.isPending} onPress={run}>
				<TbFileImport size={16} /> Import
			</Button>
			<Modal isOpen={result !== null} onOpenChange={(isOpen) => !isOpen && setResult(null)}>
				<Modal.Backdrop>
					<Modal.Container placement="center" size="md">
						<Modal.Dialog>
							<Modal.Header className="flex flex-row items-center justify-between">
								<Modal.Heading>Route imported with changes</Modal.Heading>
								<CloseButton />
							</Modal.Header>
							<Modal.Body className="flex flex-col gap-2">
								<p className="text-sm text-muted">
									The route was created. Some things didn't exist in this project and were left out:
								</p>
								<ul className="list-disc space-y-1 pl-5 text-sm">
									{result?.warnings.map((warning) => (
										<li key={warning}>{warning}</li>
									))}
								</ul>
							</Modal.Body>
							<Modal.Footer>
								<Button variant="ghost" onPress={() => setResult(null)}>
									Stay here
								</Button>
								<Button
									variant="primary"
									onPress={() => {
										if (result) open(result.id);
										setResult(null);
									}}
								>
									Open route
								</Button>
							</Modal.Footer>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
		</>
	);
}
