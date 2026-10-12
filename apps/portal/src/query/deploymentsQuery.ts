import { toast } from "@fluxify/components";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type DeployBody, deploymentsService } from "@/services/deployments";
import type { VersionKind } from "@/services/versions";

const typeKey = (kind: VersionKind) => (kind === "route" ? "routes" : "workflows");
const root = (kind: VersionKind, id: string) => [typeKey(kind), id];
const listKey = (kind: VersionKind, id: string) => [...root(kind, id), "deployments"];

/** how often a pending deployment is re-read while the dialog shows it */
export const DEPLOY_POLL_MS = 1500;

/**
 * Promote and rollback (#739). The log lives under the target, like its
 * versions. A deployment that is `pending` while the gates run is polled until
 * it is `live` or `failed`; the same query drives the dialog and the panel.
 */
export const deploymentsQuery = {
	list: {
		useQuery(kind: VersionKind, id: string) {
			return useQuery({
				queryKey: listKey(kind, id),
				queryFn: () => deploymentsService.list(kind, id),
				enabled: Boolean(id),
				refetchOnWindowFocus: false,
				// while a deployment's gates run, keep the log current so a row
				// does not sit on "Pending" after it has already gone live (#739)
				refetchInterval: (query) =>
					query.state.data?.deployments.some((deployment) => deployment.status === "pending")
						? DEPLOY_POLL_MS
						: false,
			});
		},
	},
	get: {
		useQuery(kind: VersionKind, id: string, deploymentId: string | undefined) {
			return useQuery({
				queryKey: [...listKey(kind, id), deploymentId],
				queryFn: () => deploymentsService.get(kind, id, deploymentId as string),
				enabled: Boolean(id && deploymentId),
				refetchOnWindowFocus: false,
				// a settled deployment never changes again, so polling stops with it
				refetchInterval: (query) =>
					query.state.data?.status === "pending" ? DEPLOY_POLL_MS : false,
			});
		},
	},
	deploy: {
		mutation(kind: VersionKind, id: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: DeployBody) => deploymentsService.deploy(kind, id, body),
				onSuccess: () =>
					Promise.all([
						qc.invalidateQueries({ queryKey: listKey(kind, id) }),
						// the promoted version changes what is live: the badges, the panel and the chip
						qc.invalidateQueries({ queryKey: [...root(kind, id), "versions"] }),
						qc.invalidateQueries({ queryKey: [...root(kind, id), "by-id"] }),
						qc.invalidateQueries({ queryKey: [typeKey(kind), "list"] }),
					]),
			});
		},
	},
};

/**
 * Polls a deployment to its end and toasts the outcome, whether or not the
 * dialog is still on screen. Started when a pending dialog is closed, so the
 * person is told when it goes live or fails.
 */
export async function watchDeployment(
	kind: VersionKind,
	id: string,
	deploymentId: string,
): Promise<void> {
	for (;;) {
		await new Promise((resolve) => setTimeout(resolve, DEPLOY_POLL_MS));
		let deployment: Awaited<ReturnType<typeof deploymentsService.get>>;
		try {
			deployment = await deploymentsService.get(kind, id, deploymentId);
		} catch {
			return;
		}
		if (deployment.status === "pending") continue;
		if (deployment.status === "live") {
			toast.success(
				deployment.action === "rollback"
					? `Rolled back to v${deployment.versionNumber}: live in production`
					: `v${deployment.versionNumber} is live in production`,
			);
		} else {
			toast.danger(`v${deployment.versionNumber} was not deployed; the checks failed`);
		}
		return;
	}
}
