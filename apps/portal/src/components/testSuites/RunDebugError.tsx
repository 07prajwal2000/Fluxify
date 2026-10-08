import { DebugErrorView } from "@fluxify/components";
import type { DebugError } from "@fluxify/server/src/modules/requestRouter/debugError";
import { useNavigate } from "@tanstack/react-router";
import type { SuiteTarget } from "@/services/testSuites";

/**
 * A failed run's real error. The block name opens that block on its canvas, with
 * the error in its Diagnostics tab.
 */
export function RunDebugError({
	projectId,
	target,
	debug,
}: {
	projectId: string;
	target: SuiteTarget;
	debug: DebugError;
}) {
	const navigate = useNavigate();
	return (
		<DebugErrorView
			error={debug}
			onSelectBlock={(block, error) => {
				const search = { block, error };
				if (target.type === "route") {
					void navigate({
						to: "/$projectId/canvas/$routeId",
						params: { projectId, routeId: target.id },
						search,
					});
				} else {
					void navigate({
						to: "/$projectId/workflow-canvas/$workflowId",
						params: { projectId, workflowId: target.id },
						search,
					});
				}
			}}
		/>
	);
}
