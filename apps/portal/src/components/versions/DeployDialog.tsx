import { Button, CloseButton, Modal, toast } from "@fluxify/components";
import { useEffect, useRef, useState } from "react";
import { DeployComment } from "@/components/ai/DeployComment";
import { parseApiError } from "@/lib/errorNotifier";
import { deploymentsQuery, watchDeployment } from "@/query/deploymentsQuery";
import type { Deployment } from "@/services/deployments";
import type { Version, VersionKind } from "@/services/versions";
import { GateList } from "./DeploymentGates";

/**
 * Promotes a version to production, or rolls back to an older one (#739). The
 * description is required and kept in the log. On submit it shows the gates
 * live while they run, then "Live in production" or the failure reasons.
 * Closing while it is pending is allowed; a toast says how it ends.
 */
export function DeployDialog({
	kind,
	id,
	version,
	liveVersionNumber,
	onClose,
}: {
	kind: VersionKind;
	id: string;
	version: Version;
	/** production's version now; a smaller number makes this a rollback */
	liveVersionNumber: number | null;
	onClose: () => void;
}) {
	const isRollback = liveVersionNumber !== null && version.versionNumber < liveVersionNumber;
	const [description, setDescription] = useState("");
	const [started, setStarted] = useState<Deployment>();
	const [error, setError] = useState<string>();
	const deploy = deploymentsQuery.deploy.mutation(kind, id);
	const polled = deploymentsQuery.get.useQuery(
		kind,
		id,
		started?.status === "pending" ? started.id : undefined,
	);
	const deployment = polled.data ?? started;

	const notified = useRef(false);
	const status = deployment?.status;
	useEffect(() => {
		if (!deployment || status === "pending" || notified.current) return;
		notified.current = true;
		if (status === "live") toast.success("Live in production");
		else toast.danger("The checks failed; production is unchanged");
	}, [deployment, status]);

	function close() {
		// keep watching a pending deployment so the person hears how it ends
		if (deployment?.status === "pending") void watchDeployment(kind, id, deployment.id);
		onClose();
	}

	function submit() {
		const trimmed = description.trim();
		if (!trimmed || deploy.isPending) return;
		setError(undefined);
		deploy.mutate(
			{ versionId: version.id, description: trimmed },
			{
				onSuccess: setStarted,
				// the 409 "A deployment is already in progress" reads here, not as a toast
				onError: (cause) => setError(parseApiError(cause).message),
			},
		);
	}

	const heading = isRollback
		? `Roll back to v${version.versionNumber}`
		: `Promote v${version.versionNumber} to production`;

	return (
		<Modal isOpen onOpenChange={(open) => !open && close()}>
			<Modal.Backdrop>
				<Modal.Container placement="center">
					<Modal.Dialog className="w-[32rem] max-w-[92vw]">
						<Modal.Header className="flex flex-row items-center gap-3">
							<Modal.Heading className="text-sm font-semibold">{heading}</Modal.Heading>
							<CloseButton aria-label="Close" className="ml-auto" />
						</Modal.Header>
						<Modal.Body className="flex flex-col gap-3">
							{!started ? (
								<>
									<p className="text-xs text-muted">
										Fluxify runs this version's checks. If they all pass, production switches to v
										{version.versionNumber}. Nothing changes while they run.
									</p>
									<DeployComment
										value={description}
										onChange={setDescription}
										label="Description"
									/>
									{error && <p className="text-xs text-danger">{error}</p>}
								</>
							) : (
								<>
									<p className="text-xs text-muted">
										{deployment?.status === "pending"
											? "Running the checks…"
											: deployment?.status === "live"
												? `v${version.versionNumber} is live in production.`
												: `v${version.versionNumber} could not go live. Production is unchanged.`}
									</p>
									<GateList kind={kind} deployment={deployment} />
								</>
							)}
						</Modal.Body>
						<Modal.Footer className="flex flex-row items-center justify-end gap-2">
							<Button variant="ghost" onPress={close}>
								{started ? "Close" : "Cancel"}
							</Button>
							{!started && (
								<Button
									variant="primary"
									isDisabled={!description.trim()}
									isPending={deploy.isPending}
									onPress={submit}
								>
									{isRollback ? "Roll back" : "Promote"}
								</Button>
							)}
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
