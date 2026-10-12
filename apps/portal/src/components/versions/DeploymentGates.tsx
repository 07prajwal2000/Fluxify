import { cn } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { TbAlertTriangle, TbCheck, TbLoader2, TbMinus, TbX } from "react-icons/tb";
import type { DeployGateRef, Deployment, DeploymentGate } from "@/services/deployments";
import type { VersionKind } from "@/services/versions";
import { DependencyRefs, FailureRefs } from "./GateRefs";

type GateKey = DeploymentGate["gate"];
type GateStatus = DeploymentGate["status"] | "pending";

export const GATE_LABELS: Record<GateKey, string> = {
	compile: "Compiles",
	values: "Production values",
	path: "Production path is free",
	custom_blocks: "Custom blocks and middlewares",
	tests: "Tests",
};

/** The gates a promote runs, in the order it runs them; a workflow has no path. */
export function gateKeys(kind: VersionKind): GateKey[] {
	const keys: GateKey[] = ["compile", "values"];
	if (kind === "route") keys.push("path");
	keys.push("custom_blocks", "tests");
	return keys;
}

const TONE: Record<GateStatus, string> = {
	passed: "text-success",
	failed: "text-danger",
	warning: "text-warning",
	skipped: "text-muted",
	pending: "text-muted",
};

/** One gate's outcome: a spinner while it runs, then its icon and colour. */
export function GateStatusIcon({ status }: { status: GateStatus }) {
	const className = cn("shrink-0", TONE[status]);
	if (status === "passed") return <TbCheck size={15} className={className} aria-label="Passed" />;
	if (status === "failed") return <TbX size={15} className={className} aria-label="Failed" />;
	if (status === "warning")
		return <TbAlertTriangle size={15} className={className} aria-label="Warning" />;
	if (status === "skipped") return <TbMinus size={15} className={className} aria-label="Skipped" />;
	return <TbLoader2 size={15} className={cn(className, "animate-spin")} aria-label="Running" />;
}

function GateRow({
	gate,
	status,
	message,
	items,
	refs,
	link,
}: {
	gate: GateKey;
	status: GateStatus;
	message?: string;
	items?: string[];
	/** what the message is about, with links (#740) */
	refs?: ReactNode;
	/** a follow-up link under the row, e.g. the tests gate's failed run */
	link?: ReactNode;
}) {
	return (
		<li className="flex flex-col gap-1">
			<div className="flex items-start gap-2">
				<span className="mt-0.5">
					<GateStatusIcon status={status} />
				</span>
				<span className="text-xs font-medium text-foreground">{GATE_LABELS[gate]}</span>
				{status === "pending" ? (
					<span className="text-xs text-muted">Running…</span>
				) : (
					message && <span className="text-xs text-muted">{message}</span>
				)}
			</div>
			{items && items.length > 0 && (
				<ul className="ml-6 list-disc text-xs text-muted">
					{items.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			)}
			{refs}
			{link}
		</li>
	);
}

/**
 * The gate list for a deployment. While it is pending every gate shows a
 * spinner; once it settles each row carries its own outcome and message. The
 * tests gate names the user whose suite failed and links to it; the
 * custom_blocks gate names each dependency with no production version and, when
 * the dialog can act, offers to commit and promote it (#739, #740).
 */
export function GateList({
	kind,
	id,
	projectId,
	deployment,
	onCommitDependency,
	resolvedDeps,
	onTryAgain,
	canPromoteDeps,
}: {
	kind: VersionKind;
	id: string;
	projectId: string;
	deployment?: Deployment;
	/** the custom_blocks gate's "Commit & promote" (#740) */
	onCommitDependency?: (dependency: DeployGateRef) => void;
	/** dependencies promoted in this dialog already */
	resolvedDeps?: Set<string>;
	/** re-run the original promote once every dependency is live */
	onTryAgain?: () => void;
	canPromoteDeps?: boolean;
}) {
	const pending = !deployment || deployment.status === "pending";
	const byGate = new Map((deployment?.gates ?? []).map((gate) => [gate.gate, gate]));
	// only a route's or a workflow's own run is opened from its own tests gate
	const suiteTo =
		kind === "route"
			? "/$projectId/canvas/$routeId/test-suites"
			: kind === "workflow"
				? "/$projectId/workflow-canvas/$workflowId/test-suites"
				: null;
	const suiteParams = kind === "route" ? { projectId, routeId: id } : { projectId, workflowId: id };
	return (
		<ul aria-label="Promote checks" className="flex flex-col gap-2">
			{gateKeys(kind).map((gate) => {
				const result = byGate.get(gate);
				return (
					<GateRow
						key={gate}
						gate={gate}
						status={pending ? "pending" : (result?.status ?? "skipped")}
						message={result?.message}
						items={result?.items}
						refs={
							result?.refs?.length ? (
								gate === "custom_blocks" && onCommitDependency ? (
									<DependencyRefs
										projectId={projectId}
										refs={result.refs}
										resolved={resolvedDeps ?? new Set()}
										canPromote={canPromoteDeps ?? false}
										onCommitAndPromote={onCommitDependency}
										onTryAgain={onTryAgain ?? (() => undefined)}
									/>
								) : (
									<FailureRefs projectId={projectId} refs={result.refs} />
								)
							) : undefined
						}
						link={
							gate === "tests" && result?.runId && suiteTo ? (
								<Link
									to={suiteTo as never}
									params={suiteParams as never}
									search={{ runId: result.runId } as never}
									className="ml-6 w-fit text-xs font-medium text-accent hover:underline"
								>
									Open the failed tests
								</Link>
							) : undefined
						}
					/>
				);
			})}
		</ul>
	);
}
