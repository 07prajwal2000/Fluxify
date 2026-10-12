import { cn } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { TbRocket } from "react-icons/tb";
import type { VersionKind } from "@/services/versions";
import { useVersionTarget } from "./useVersionTarget";

/**
 * The version production serves, in the route or workflow canvas header (#739).
 * It opens the version history, where it can be promoted or rolled back.
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
	const to =
		kind === "route"
			? "/$projectId/canvas/$routeId/versions"
			: "/$projectId/workflow-canvas/$workflowId/versions";
	const params = kind === "route" ? { projectId, routeId: id } : { projectId, workflowId: id };
	return (
		<Link
			to={to as never}
			params={params as never}
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
