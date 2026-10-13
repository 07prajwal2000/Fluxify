import { Button, CloseButton, Modal, toast } from "@fluxify/components";
import { useEffect, useRef, useState } from "react";
import { DeployComment } from "@/components/ai/DeployComment";
import { useConfetti } from "@/hooks/useConfetti";
import { parseApiError } from "@/lib/errorNotifier";
import { deploymentsQuery } from "@/query/deploymentsQuery";
import { versionsQuery } from "@/query/versionsQuery";
import type { DeployGateRef, Deployment } from "@/services/deployments";
import type { ReferenceSubjectKind } from "@/services/references";
import { GateList } from "./DeploymentGates";
import { useVersionTarget } from "./useVersionTarget";

/**
 * Commits a dependency's working copy, if it has any, and promotes it (#740) —
 * the one-click fix behind the route promote's custom_blocks gate. It shows the
 * dependency's own gates inline. No chain: this promotes one block or
 * middleware, never the dependency's dependencies.
 */
export function DependencyPromoteDialog({
	subjectName,
	dependency,
	projectId,
	onClose,
	onPromoted,
}: {
	/** the route, workflow, block or middleware being promoted, for the default title */
	subjectName: string;
	dependency: DeployGateRef;
	projectId: string;
	onClose: () => void;
	/** the dependency is live: the caller can try its own promote again */
	onPromoted: () => void;
}) {
	const kind = dependency.kind as ReferenceSubjectKind;
	const { uncommitted } = useVersionTarget(kind, dependency.id);
	const { data } = versionsQuery.list.useQuery(kind, dependency.id);
	const head = data?.versions.find((version) => version.isHead);
	const commit = versionsQuery.commit.mutation(kind, dependency.id);
	const deploy = deploymentsQuery.deploy.mutation(kind, dependency.id);

	const [title, setTitle] = useState(`Promote for ${subjectName}`);
	const [description, setDescription] = useState("");
	const [started, setStarted] = useState<Deployment>();
	const [error, setError] = useState<string>();
	const polled = deploymentsQuery.get.useQuery(
		kind,
		dependency.id,
		started?.status === "pending" ? started.id : undefined,
	);
	const deployment = polled.data ?? started;

	const notified = useRef(false);
	const fireConfetti = useConfetti();
	const status = deployment?.status;
	useEffect(() => {
		if (!deployment || status === "pending" || notified.current) return;
		notified.current = true;
		if (status === "live") {
			fireConfetti(document.querySelector<HTMLElement>('[role="dialog"]'));
			toast.success(`${dependency.name} is live in production`);
			onPromoted();
		}
	}, [deployment, status, dependency.name, onPromoted, fireConfetti]);

	async function submit() {
		const body = description.trim();
		if (!body || commit.isPending || deploy.isPending) return;
		setError(undefined);
		try {
			let versionId = head?.id;
			if (uncommitted) {
				const committed = await commit.mutateAsync({
					title: title.trim() || `Promote for ${subjectName}`,
					description: body,
				});
				versionId = committed.id;
			}
			if (!versionId) {
				setError("Nothing to promote yet. Commit a version first.");
				return;
			}
			setStarted(await deploy.mutateAsync({ versionId, description: body }));
		} catch (cause) {
			setError(parseApiError(cause).message);
		}
	}

	const pending = commit.isPending || deploy.isPending;
	const live = deployment?.status === "live";
	// with nothing to commit we promote the head, so wait until we know which version that is
	const ready = uncommitted || Boolean(head);

	return (
		<Modal isOpen onOpenChange={(open) => !open && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center">
					<Modal.Dialog className="w-[32rem] max-w-[92vw]">
						<Modal.Header className="flex flex-row items-center gap-3">
							<Modal.Heading className="text-sm font-semibold">
								Commit &amp; promote {dependency.name}
							</Modal.Heading>
							<CloseButton aria-label="Close" className="ml-auto" />
						</Modal.Header>
						<Modal.Body className="flex flex-col gap-3">
							{!started ? (
								<>
									<p className="text-xs text-muted">
										{uncommitted
											? "This saves its working copy as a new version, then puts it live. Its own checks run first."
											: "This puts its latest version live. Its own checks run first."}
									</p>
									{uncommitted && (
										<label className="flex flex-col gap-1 text-xs">
											<span className="font-medium text-foreground">Commit title</span>
											<input
												className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
												value={title}
												onChange={(event) => setTitle(event.target.value)}
												maxLength={255}
											/>
										</label>
									)}
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
											: live
												? `${dependency.name} is live in production.`
												: `${dependency.name} could not go live.`}
									</p>
									<GateList
										kind={kind}
										id={dependency.id}
										projectId={projectId}
										deployment={deployment}
									/>
								</>
							)}
						</Modal.Body>
						<Modal.Footer className="flex flex-row items-center justify-end gap-2">
							<Button variant="ghost" onPress={onClose}>
								{started ? "Close" : "Cancel"}
							</Button>
							{!started && (
								<Button
									variant="primary"
									isDisabled={!description.trim() || !ready}
									isPending={pending}
									onPress={() => void submit()}
								>
									{uncommitted ? "Commit & promote" : "Promote"}
								</Button>
							)}
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
