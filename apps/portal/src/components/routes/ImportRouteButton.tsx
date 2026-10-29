import { Button, CloseButton, Input, Label, Modal, TextField, toast } from "@fluxify/components";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LuImport } from "react-icons/lu";
import { parseApiError, showErrorNotification } from "@/lib/errorNotifier";
import { routesQuery } from "@/query/routesQuery";
import { type RouteBundle, routesService } from "@/services/routes";
import { RouteBundlePreview } from "./RouteBundlePreview";
import { pickRouteFile, readRouteFile } from "./routeFile";
import { conflictNotice, importDefaults } from "./routeImport";

/** A picked file waiting for the user to confirm, with the name and path it will take. */
type Pending = {
	bundle: RouteBundle;
	name: string;
	path: string;
	/** what already exists here, as found when the file was picked */
	notice?: string;
	error?: string;
};

/** Picks an exported route file, shows what is in it, and creates the route once confirmed. */
export function ImportRouteButton({ projectId }: { projectId: string }) {
	const navigate = useNavigate();
	const importRoute = routesQuery.import.mutation();
	const [pending, setPending] = useState<Pending | null>(null);
	// set when the import left something out: the user reads it before opening the route
	const [result, setResult] = useState<{ id: string; warnings: string[] } | null>(null);

	const open = (routeId: string) =>
		navigate({ to: "/$projectId/canvas/$routeId", params: { projectId, routeId } });

	const pick = async () => {
		const file = await pickRouteFile();
		if (!file) return;
		try {
			const bundle = await readRouteFile(file);
			// asked before the dialog opens, so a clash is already dealt with when it does
			const { name, path, method } = bundle.route;
			const conflicts = await routesService.checkImport(projectId, { name, path, method });
			setPending({
				bundle,
				...importDefaults(bundle.route, conflicts),
				notice: conflictNotice(bundle.route, conflicts),
			});
		} catch (error) {
			showErrorNotification(error);
		}
	};

	const confirm = async () => {
		if (!pending) return;
		const { bundle, name, path } = pending;
		try {
			const done = await importRoute.mutateAsync({
				projectId,
				bundle: { ...bundle, route: { ...bundle.route, name, path } },
			});
			setPending(null);
			if (done.warnings.length > 0) return setResult(done);
			toast.success("Route imported");
			open(done.id);
		} catch (error) {
			const { status, message } = parseApiError(error);
			// a name or path already taken stays in the dialog, where both can be changed
			if (status === 409) return setPending({ ...pending, error: message });
			showErrorNotification(error);
		}
	};

	const edit = (patch: Partial<Pick<Pending, "name" | "path">>) =>
		setPending((p) => (p ? { ...p, ...patch, notice: undefined, error: undefined } : p));

	return (
		<>
			<Button variant="outline" onPress={pick}>
				<LuImport size={16} /> Import
			</Button>
			<Modal isOpen={pending !== null} onOpenChange={(isOpen) => !isOpen && setPending(null)}>
				<Modal.Backdrop>
					<Modal.Container placement="center" size="lg">
						<Modal.Dialog className="w-full !max-w-6xl max-h-[90vh]">
							<Modal.Header className="flex flex-row items-center justify-between">
								<Modal.Heading>Import this route?</Modal.Heading>
								<CloseButton />
							</Modal.Header>
							<Modal.Body className="grid min-h-0 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
								<div className="flex flex-col gap-3">
									<p className="text-sm text-muted">
										This creates a new route in this project
										{pending?.bundle.suites
											? ` with its ${pending.bundle.suites.length} test suite(s)`
											: ""}
										. The blocks inside it are on the right: click one to see its settings.
									</p>
									<TextField value={pending?.name ?? ""} onChange={(name) => edit({ name })}>
										<Label>Name</Label>
										<Input />
									</TextField>
									<TextField value={pending?.path ?? ""} onChange={(path) => edit({ path })}>
										<Label>Path</Label>
										<Input className="font-mono" />
									</TextField>
									{pending?.notice && <p className="text-sm text-warning">{pending.notice}</p>}
									{pending?.error && <p className="text-sm text-danger">{pending.error}</p>}
								</div>
								{pending && <RouteBundlePreview bundle={pending.bundle} />}
							</Modal.Body>
							<Modal.Footer>
								<Button variant="ghost" onPress={() => setPending(null)}>
									Cancel
								</Button>
								<Button variant="primary" isPending={importRoute.isPending} onPress={confirm}>
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
