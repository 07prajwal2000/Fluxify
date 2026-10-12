import { cn } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { TbRocket } from "react-icons/tb";
import type { VersionKind } from "@/services/versions";
import { useVersionTarget } from "./useVersionTarget";

/** The version history route and its params, per kind (#740). */
function historyTarget(kind: VersionKind, projectId: string, id: string) {
	if (kind === "route")
		return { to: "/$projectId/canvas/$routeId/versions", params: { projectId, routeId: id } };
	if (kind === "workflow")
		return {
			to: "/$projectId/workflow-canvas/$workflowId/versions",
			params: { projectId, workflowId: id },
		};
	if (kind === "custom_block")
		return {
			to: "/$projectId/custom-block-canvas/$blockId/versions",
			params: { projectId, blockId: id },
		};
	return {
		to: "/$projectId/middlewares/$middlewareId/versions",
		params: { projectId, middlewareId: id },
	};
}

/**
 * The version production serves, in the route, workflow, custom-block or
 * middleware header (#739, #740). It opens the version history, where it can be
 * promoted or rolled back.
 */
export function ProductionChip({
	kind,
	id,
	projectId,
}: {
	kind: VersionKind;
	id: string;
	projectId: string;
}) {
	const { prodVersionNumber } = useVersionTarget(kind, id);
	const target = historyTarget(kind, projectId, id);
	return (
		<Link
			to={target.to as never}
			params={target.params as never}
			// land on the Production tab, so the click answers "which version is live"
			search={{ tab: "production" } as never}
			title={
				prodVersionNumber
					? `Production serves v${prodVersionNumber}. Open the production history`
					: "Nothing is promoted yet. Open the version history to promote one"
			}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
				prodVersionNumber
					? "border-success/40 bg-success/10 text-success"
					: "border-border bg-surface text-muted",
			)}
		>
			<TbRocket size={13} />
			{prodVersionNumber ? `Prod v${prodVersionNumber}` : "Not in production"}
		</Link>
	);
}
