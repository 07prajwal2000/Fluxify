import { Button, CloseButton, Input, Label, Modal, TextField, toast } from "@fluxify/components";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { TbFileImport } from "react-icons/tb";
import { parseApiError, showErrorNotification } from "@/lib/errorNotifier";
import { routesQuery } from "@/query/routesQuery";
import type { RouteBundle } from "@/services/routes";
import { pickRouteFile, readRouteFile } from "./routeFile";

/** A route that already exists here: the file waits while the user renames it. */
type Conflict = { bundle: RouteBundle; message: string; name: string; path: string };

/** Picks an exported route file and creates the route (and its tests) from it. */
export function ImportRouteButton({ projectId }: { projectId: string }) {
	const navigate = useNavigate();
	const importRoute = routesQuery.import.mutation();
	// set when the import left something out: the user reads it before opening the route
	const [result, setResult] = useState<{ id: string; warnings: string[] } | null>(null);
	const [conflict, setConflict] = useState<Conflict | null>(null);

	const open = (routeId: string) =>
		navigate({ to: "/$projectId/canvas/$routeId", params: { projectId, routeId } });

	/** Imports `bundle`; a name or path clash opens the rename dialog instead of failing. */
	const submit = async (bundle: RouteBundle) => {
		try {
			const done = await importRoute.mutateAsync({ projectId, bundle });
			setConflict(null);
			if (done.warnings.length > 0) return setResult(done);
			toast.success("Route imported");
			open(done.id);
		} catch (error) {
			const { status, message } = parseApiError(error);
			if (status !== 409) return showErrorNotification(error);
			const { name, path } = bundle.route;
			setConflict({ bundle, message, name, path });
		}
	};

	const run = async () => {
		const file = await pickRouteFile();
		if (!file) return;
		try {
			await submit(await readRouteFile(file));
		} catch (error) {
			showErrorNotification(error);
		}
	};

	const edit = (patch: Partial<Pick<Conflict, "name" | "path">>) =>
		setConflict((c) => (c ? { ...c, ...patch } : c));

	return (
		<>
			<Button variant="outline" isPending={importRoute.isPending} onPress={run}>
				<TbFileImport size={16} /> Import
			</Button>
			<Modal isOpen={conflict !== null} onOpenChange={(isOpen) => !isOpen && setConflict(null)}>
				<Modal.Backdrop>
					<Modal.Container placement="center" size="md">
						<Modal.Dialog>
							<Modal.Header className="flex flex-row items-center justify-between">
								<Modal.Heading>This route already exists</Modal.Heading>
								<CloseButton />
							</Modal.Header>
							<Modal.Body className="flex flex-col gap-3">
								<p className="text-sm text-muted">{conflict?.message}</p>
								<p className="text-sm text-muted">
									Change the name or path to import it as a new route.
								</p>
								<TextField value={conflict?.name ?? ""} onChange={(name) => edit({ name })}>
									<Label>Name</Label>
									<Input />
								</TextField>
								<TextField value={conflict?.path ?? ""} onChange={(path) => edit({ path })}>
									<Label>Path</Label>
									<Input className="font-mono" />
								</TextField>
							</Modal.Body>
							<Modal.Footer>
								<Button variant="ghost" onPress={() => setConflict(null)}>
									Cancel
								</Button>
								<Button
									variant="primary"
									isPending={importRoute.isPending}
									onPress={() =>
										conflict &&
										submit({
											...conflict.bundle,
											route: { ...conflict.bundle.route, name: conflict.name, path: conflict.path },
										})
									}
								>
									Import
								</Button>
							</Modal.Footer>
						</Modal.Dialog>
					</Modal.Container>
				</Modal.Backdrop>
			</Modal>
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
