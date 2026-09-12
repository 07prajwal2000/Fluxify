import { useState } from "react";
import {
	Button,
	CloseButton,
	CustomSelect,
	Label,
	Modal,
	MultiSelect,
	NumberField,
} from "@fluxify/components";
import { TbInfoCircle } from "react-icons/tb";
import type { ClaimView, OrchestrationStatus } from "@/services/orchestration";
import { CONSEQUENCE, TYPE_LABEL } from "./copy";

/** What a node runs, taken from the wire type so it cannot drift from the API. */
export type ClaimType = ClaimView["type"];

/**
 * Asking for a workload, or changing one.
 *
 * A claim is one workload: what it runs, which trigger groups it serves, and
 * how many identical copies of it to run. Several per project is normal — a
 * project's APIs and its slow queue are different workloads that want different
 * amounts of capacity.
 *
 * Every control here states its consequence *before* it is used, which is a
 * requirement of the feature and not decoration: some of these changes reach a
 * running node in seconds and some of them start and stop containers, and
 * nobody should find out which afterwards.
 */

export interface GroupOption {
	id: string;
	name: string;
}

export function ClaimDialog({
	status,
	groups,
	claim,
	isOpen,
	isPending,
	error,
	onClose,
	onSubmit,
}: {
	status: OrchestrationStatus;
	groups: GroupOption[];
	/** Present when changing an existing claim; absent when making a new one. */
	claim?: ClaimView;
	isOpen: boolean;
	isPending?: boolean;
	/** The server's refusal, shown as written — it is the whole answer. */
	error?: string | null;
	onClose: () => void;
	onSubmit: (body: { type: ClaimType; groupIds: string[]; replicas: number }) => void;
}) {
	const [type, setType] = useState<ClaimType>(claim?.type ?? "workflow");
	const [groupIds, setGroupIds] = useState<string[]>(claim?.groupIds ?? []);
	const [replicas, setReplicas] = useState(claim?.replicas ?? 1);

	const servesWorkflows = type === "workflow" || type === "both";
	const allowed = status.entitlement.types;
	const typeOptions = (["workflow", "route", "both"] as ClaimType[])
		.filter((option) => allowed.includes(option))
		.filter((option) => status.canClaimRoutes || option === "workflow")
		.map((option) => ({ value: option, label: TYPE_LABEL[option]! }));

	const scaleWords =
		claim && replicas !== claim.replicas
			? replicas > claim.replicas
				? CONSEQUENCE.scaleUp
				: CONSEQUENCE.scaleDown
			: null;
	const willPend =
		status.pool.placed + (claim ? replicas - claim.replicas : replicas) > status.pool.ceiling;

	return (
		<Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="md">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>
								{claim ? "Change this workload" : "Claim a workload"}
							</Modal.Heading>
							<CloseButton onPress={onClose} />
						</Modal.Header>

						<Modal.Body className="flex flex-col gap-5">
									{!status.canClaimRoutes && (
										<Note>
											This project can only claim workflow nodes for now. A node that serves your APIs is
											reached on its own subdomain, and this project does not have one yet.
										</Note>
									)}

									<div className="flex flex-col gap-1.5">
										<CustomSelect
											label="What should it run?"
											options={typeOptions}
											value={type}
											onChange={(next) => setType(next as ClaimType)}
										/>
										{claim && <Hint>{CONSEQUENCE.live}</Hint>}
									</div>

									{servesWorkflows && (
										<div className="flex flex-col gap-1.5">
											<MultiSelect
												label="Trigger groups it serves"
												options={groups.map((group) => ({ value: group.id, label: group.name }))}
												value={groupIds}
												onChange={setGroupIds}
												placeholder={groups.length ? "Choose groups" : "This project has no groups yet"}
												isDisabled={groups.length === 0}
												fullWidth
											/>
											<Hint>
												{claim
													? CONSEQUENCE.live
													: "A node only runs the groups you choose. Raise the copies below when a group falls behind."}
											</Hint>
										</div>
									)}

									<div className="flex flex-col gap-1.5">
										<NumberField
											value={replicas}
											minValue={1}
											maxValue={50}
											onChange={(next) => setReplicas(Math.max(1, Math.min(50, next || 1)))}
											className="w-40"
										>
											<Label>Identical copies</Label>
											<NumberField.Group>
												<NumberField.DecrementButton />
												<NumberField.Input />
												<NumberField.IncrementButton />
											</NumberField.Group>
										</NumberField>
										<Hint>{scaleWords ?? CONSEQUENCE.scaleUp}</Hint>
										{willPend && <Note>{CONSEQUENCE.pending}</Note>}
										{status.entitlement.maxReplicas === 1 && <Note>{CONSEQUENCE.singleNode}</Note>}
									</div>

							{error && <p className="text-sm text-danger">{error}</p>}
						</Modal.Body>

						<Modal.Footer>
							<Button variant="ghost" onPress={onClose}>
								Cancel
							</Button>
							<Button
								variant="primary"
								isPending={isPending}
								isDisabled={typeOptions.length === 0}
								onPress={() =>
									onSubmit({ type, groupIds: servesWorkflows ? groupIds : [], replicas })
								}
							>
								{claim ? "Save changes" : "Claim"}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

const Hint = ({ children }: { children: React.ReactNode }) => (
	<p className="text-xs text-muted">{children}</p>
);

const Note = ({ children }: { children: React.ReactNode }) => (
	<div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5">
		<TbInfoCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
		<p className="text-xs text-foreground">{children}</p>
	</div>
);
