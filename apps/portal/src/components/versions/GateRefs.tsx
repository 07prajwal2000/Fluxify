import { Button } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import type { DeployGateRef } from "@/services/deployments";
import { KindIcon } from "./ReferenceList";

/** Where a gate's reference opens: the target's canvas, per kind. */
function refLink(ref: DeployGateRef, projectId: string) {
	if (ref.kind === "route")
		return { to: "/$projectId/canvas/$routeId", params: { projectId, routeId: ref.id } };
	if (ref.kind === "workflow")
		return {
			to: "/$projectId/workflow-canvas/$workflowId",
			params: { projectId, workflowId: ref.id },
		};
	if (ref.kind === "custom_block")
		return {
			to: "/$projectId/custom-block-canvas/$blockId",
			params: { projectId, blockId: ref.id },
		};
	return {
		to: "/$projectId/middlewares/$middlewareId",
		params: { projectId, middlewareId: ref.id },
	};
}

function RefName({ gateRef, projectId }: { gateRef: DeployGateRef; projectId: string }) {
	const link = refLink(gateRef, projectId);
	return (
		<Link
			to={link.to as never}
			params={link.params as never}
			className="min-w-0 truncate font-medium text-accent hover:underline"
		>
			{gateRef.name}
		</Link>
	);
}

/**
 * The tests gate's failures (#739, #740): each route, workflow, block or
 * middleware whose suite failed, with the suite's name and a link to it.
 */
export function FailureRefs({ projectId, refs }: { projectId: string; refs: DeployGateRef[] }) {
	return (
		<ul className="ml-6 flex flex-col gap-1">
			{refs.map((gateRef) => (
				<li
					key={`${gateRef.id}-${gateRef.suite ?? ""}`}
					className="flex items-center gap-2 text-xs"
				>
					<KindIcon kind={gateRef.kind} />
					<RefName gateRef={gateRef} projectId={projectId} />
					{gateRef.suite && <span className="truncate text-muted">{gateRef.suite}</span>}
				</li>
			))}
		</ul>
	);
}

/**
 * The custom_blocks gate's missing dependencies (#740): each block or middleware
 * with no production version, and a one-click way to commit and promote it. Once
 * every one is live the original promote can be tried again. No automatic chain.
 */
export function DependencyRefs({
	projectId,
	refs,
	resolved,
	canPromote,
	onCommitAndPromote,
	onTryAgain,
}: {
	projectId: string;
	refs: DeployGateRef[];
	resolved: Set<string>;
	canPromote: boolean;
	onCommitAndPromote: (dependency: DeployGateRef) => void;
	onTryAgain: () => void;
}) {
	const allLive = refs.length > 0 && refs.every((gateRef) => resolved.has(gateRef.id));
	return (
		<>
			<ul className="ml-6 flex flex-col gap-1">
				{refs.map((gateRef) => (
					<li key={gateRef.id} className="flex items-center gap-2 text-xs">
						<KindIcon kind={gateRef.kind} />
						<RefName gateRef={gateRef} projectId={projectId} />
						{resolved.has(gateRef.id) ? (
							<span className="shrink-0 rounded-md bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success">
								Live
							</span>
						) : canPromote ? (
							<Button
								size="sm"
								variant="outline"
								className="shrink-0"
								onPress={() => onCommitAndPromote(gateRef)}
							>
								Commit &amp; promote
							</Button>
						) : null}
					</li>
				))}
			</ul>
			{allLive && (
				<Button size="sm" variant="primary" className="ml-6 w-fit" onPress={onTryAgain}>
					Try again
				</Button>
			)}
		</>
	);
}
