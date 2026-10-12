import { Button, CloseButton, CustomSelect, Modal, MultiSelect } from "@fluxify/components";
import { useState } from "react";
import { TbInfoCircle } from "react-icons/tb";
import type { ClaimView, OrchestrationStatus } from "@/services/orchestration";
import { type ClaimScale, ClaimScaleFields } from "./ClaimScaleFields";
import { CONSEQUENCE, ENV_LABEL, providerWords, TYPE_LABEL } from "./copy";

/** What a node runs, taken from the wire type so it cannot drift from the API. */
export type ClaimType = ClaimView["type"];
/** Which environment it serves, likewise (#742). */
export type ClaimEnv = ClaimView["env"];

/** What the environment picker offers, in the order it offers it. */
const ENV_OPTIONS: ClaimEnv[] = ["production", "development"];

/**
 * Whether the claim being written may autoscale: the platform has to have an
 * autoscaler at all (Kubernetes), and a development claim never does (#742) —
 * the API refuses a maximum on one, so the field is not offered.
 */
export const autoscalesFor = (provider: string | null, env: ClaimEnv) =>
	provider === "kubernetes" && env === "production";

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

/** What the dialog hands back. `maxReplicas` is left out where nothing autoscales. */
export interface ClaimSubmit {
	type: ClaimType;
	env: ClaimEnv;
	groupIds: string[];
	replicas: number;
	maxReplicas?: number | null;
	metadata: { resources: { cpu: number; memoryMb: number } };
}

/**
 * The body a dialog submits, pure so the two rules that are easy to get wrong
 * are testable without opening a modal: a development claim never carries a
 * maximum, because it never autoscales and the API refuses one (#742), and a
 * maximum equal to the floor means "fixed size", which the API spells null.
 */
export function claimSubmit(input: {
	type: ClaimType;
	env: ClaimEnv;
	groupIds: string[];
	replicas: number;
	/** Whether the platform grows claims on its own at all (Kubernetes). */
	autoscales: boolean;
	maxReplicas: number;
	resources: { cpu: number; memoryMb: number };
}): ClaimSubmit {
	const grows = input.autoscales && input.env === "production";
	return {
		type: input.type,
		env: input.env,
		groupIds: input.groupIds,
		replicas: input.replicas,
		...(grows && { maxReplicas: input.maxReplicas > input.replicas ? input.maxReplicas : null }),
		metadata: { resources: input.resources },
	};
}

export interface GroupOption {
	id: string;
	name: string;
}

export function ClaimDialog({
	status,
	groups = [],
	claim,
	surface = "project",
	isOpen,
	isPending,
	error,
	onClose,
	onSubmit,
}: {
	status: OrchestrationStatus;
	groups?: GroupOption[];
	/** Present when changing an existing claim; absent when making a new one. */
	claim?: ClaimView;
	/**
	 * Which page this is (#423). On the instance surface a new claim is always
	 * the catch-all — which takes no groups, since empty already means "every
	 * group no dedicated claim owns" — and a project's claim is sized or
	 * released here but its type and groups are edited in that project.
	 */
	surface?: "project" | "instance";
	isOpen: boolean;
	isPending?: boolean;
	/** The server's refusal, shown as written — it is the whole answer. */
	error?: string | null;
	onClose: () => void;
	onSubmit: (body: ClaimSubmit) => void;
}) {
	// A licence that only allows `both` must not open on a type it will refuse.
	const [type, setType] = useState<ClaimType>(
		claim?.type ?? (status.entitlement.types.includes("workflow") ? "workflow" : "both"),
	);
	// Production unless the claim already serves development: the safe, ordinary
	// answer is the one the dialog opens on.
	const [env, setEnv] = useState<ClaimEnv>(claim?.env ?? "production");
	const [groupIds, setGroupIds] = useState<string[]>(claim?.groupIds ?? []);
	const [scale, setScale] = useState<ClaimScale>(() => {
		const replicas = claim?.replicas ?? 1;
		const resources = claim?.metadata?.resources;
		return {
			replicas,
			maxReplicas: claim?.maxReplicas ?? replicas,
			cpu: resources?.cpu ?? 1,
			memoryMb: resources?.memoryMb ?? 1024,
		};
	});
	const replicas = scale.replicas;
	const autoscales = autoscalesFor(status.orchestrator.provider, env);
	const node = providerWords(status.orchestrator.provider).node;

	const global = surface === "instance" && (claim ? claim.projectId === null : true);
	const replicasOnly = surface === "instance" && !!claim && claim.projectId !== null;
	const showGroups = !global && !replicasOnly && (type === "workflow" || type === "both");
	const servesWorkflows = type === "workflow" || type === "both";
	const allowed = status.entitlement.types;
	const typeOptions = (["workflow", "route", "both"] as ClaimType[])
		.filter((option) => allowed.includes(option))
		.filter((option) => status.canClaimRoutes || option === "workflow")
		.map((option) => ({ value: option, label: TYPE_LABEL[option]! }));

	const scaleWords =
		claim && replicas !== claim.replicas
			? replicas > claim.replicas
				? CONSEQUENCE.scaleUp(node)
				: CONSEQUENCE.scaleDown(node)
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
								{claim
									? "Change this workload"
									: global
										? "Claim a workload for every project"
										: "Claim a workload"}
							</Modal.Heading>
							<CloseButton onPress={onClose} />
						</Modal.Header>

						<Modal.Body className="flex flex-col gap-5">
							{!status.canClaimRoutes && (
								<Note>
									This project can only claim workflow nodes for now. A node that serves your APIs
									is reached on its own subdomain, and this project does not have one yet.
								</Note>
							)}

							{global && !claim && (
								<Hint>
									A claim made here serves every project. It runs every trigger group no project's
									own claim has taken, so there is nothing to choose — only what it runs and how
									many copies of it.
								</Hint>
							)}
							{replicasOnly && (
								<Note>
									This workload belongs to a project. What it runs and which trigger groups it
									serves are edited in that project's settings; from here you can change how many
									copies it runs, or release it.
								</Note>
							)}

							{!replicasOnly && (
								<div className="flex flex-col gap-1.5">
									<CustomSelect
										label="What should it run?"
										options={typeOptions}
										value={type}
										onChange={(next) => setType(next as ClaimType)}
									/>
									{claim && <Hint>{CONSEQUENCE.live}</Hint>}
								</div>
							)}

							{!replicasOnly && (
								<div className="flex flex-col gap-1.5">
									<CustomSelect
										label="Which environment?"
										options={ENV_OPTIONS.map((option) => ({
											value: option,
											label: ENV_LABEL[option]!,
										}))}
										value={env}
										onChange={(next) => setEnv(next as ClaimEnv)}
									/>
									<Hint>
										{env === "development" ? CONSEQUENCE.development : CONSEQUENCE.production}
									</Hint>
									{env === "development" && claim && <Hint>{CONSEQUENCE.developmentReplaces}</Hint>}
								</div>
							)}

							{showGroups && (
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
								<ClaimScaleFields
									value={scale}
									onChange={setScale}
									autoscales={autoscales}
									node={node}
									poolRoom={status.pool.ceiling - (status.pool.requested - (claim?.replicas ?? 0))}
								/>
								{autoscales && global && <Hint>{CONSEQUENCE.catchAllScaling}</Hint>}
								{!autoscales && env === "development" && (
									<Hint>{CONSEQUENCE.developmentNoAutoscale}</Hint>
								)}
								<Hint>{scaleWords ?? CONSEQUENCE.scaleUp(node)}</Hint>
								{env === "production" && status.entitlement.maxReplicas !== null && (
									<Hint>
										This licence allows {status.entitlement.maxReplicas} node(s) in total, and{" "}
										{status.pool.requested} are already claimed.
									</Hint>
								)}
								{willPend && <Note>{CONSEQUENCE.pending}</Note>}
								{env === "production" && status.entitlement.maxReplicas === 1 && (
									<Note>{CONSEQUENCE.singleNode}</Note>
								)}
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
									onSubmit(
										claimSubmit({
											type,
											env,
											groupIds: showGroups && servesWorkflows ? groupIds : [],
											replicas,
											autoscales,
											maxReplicas: scale.maxReplicas,
											resources: { cpu: scale.cpu, memoryMb: scale.memoryMb },
										}),
									)
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
