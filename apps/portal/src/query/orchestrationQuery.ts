import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	orchestrationService,
	type CreateClaimBody,
	type PatchClaimBody,
} from "@/services/orchestration";

/**
 * Node status polls, because the state it shows is a loop's output rather than
 * an event: five seconds is the reconcile interval, so a claim made now shows a
 * container shortly after without anyone pressing refresh.
 */
const POLL_MS = 5_000;

const projectKey = (projectId: string) => ["orchestration", "project", projectId];
const projectEventsKey = (projectId: string) => ["orchestration", "project", projectId, "events"];
const instanceKey = ["orchestration", "instance"];
const instanceEventsKey = ["orchestration", "instance", "events"];

export const orchestrationQuery = {
	project: {
		useQuery(projectId: string, enabled = true) {
			return useQuery({
				queryKey: projectKey(projectId),
				queryFn: () => orchestrationService.getProject(projectId),
				refetchInterval: POLL_MS,
				enabled,
			});
		},
	},
	projectEvents: {
		useQuery(projectId: string, enabled = true) {
			return useQuery({
				queryKey: projectEventsKey(projectId),
				queryFn: () => orchestrationService.getProjectEvents(projectId),
				refetchInterval: POLL_MS,
				enabled,
			});
		},
	},
	instance: {
		useQuery(enabled = true) {
			return useQuery({
				queryKey: instanceKey,
				queryFn: () => orchestrationService.getInstance(),
				refetchInterval: POLL_MS,
				enabled,
			});
		},
	},
	instanceEvents: {
		useQuery(enabled = true) {
			return useQuery({
				queryKey: instanceEventsKey,
				queryFn: () => orchestrationService.getInstanceEvents(),
				refetchInterval: POLL_MS,
				enabled,
			});
		},
	},

	claim: {
		useMutation(projectId: string) {
			const client = useQueryClient();
			return useMutation({
				mutationFn: (body: CreateClaimBody) => orchestrationService.claim(projectId, body),
				onSuccess: () => invalidate(client, projectId),
			});
		},
	},
	updateClaim: {
		useMutation(projectId: string) {
			const client = useQueryClient();
			return useMutation({
				mutationFn: ({ claimId, body }: { claimId: string; body: PatchClaimBody }) =>
					orchestrationService.updateProjectClaim(projectId, claimId, body),
				onSuccess: () => invalidate(client, projectId),
			});
		},
	},
	releaseClaim: {
		useMutation(projectId: string) {
			const client = useQueryClient();
			return useMutation({
				mutationFn: (claimId: string) =>
					orchestrationService.releaseProjectClaim(projectId, claimId),
				onSuccess: () => invalidate(client, projectId),
			});
		},
	},

	updateInstanceClaim: {
		useMutation() {
			const client = useQueryClient();
			return useMutation({
				mutationFn: ({ claimId, body }: { claimId: string; body: PatchClaimBody }) =>
					orchestrationService.updateInstanceClaim(claimId, body),
				onSuccess: () => invalidate(client),
			});
		},
	},
	releaseInstanceClaim: {
		useMutation() {
			const client = useQueryClient();
			return useMutation({
				mutationFn: (claimId: string) => orchestrationService.releaseInstanceClaim(claimId),
				onSuccess: () => invalidate(client),
			});
		},
	},
};

/**
 * A write changes both surfaces — a project's claim consumes the instance's
 * pool — so both are invalidated whichever one made the change.
 */
function invalidate(client: ReturnType<typeof useQueryClient>, projectId?: string) {
	if (projectId) {
		client.invalidateQueries({ queryKey: projectKey(projectId) });
		client.invalidateQueries({ queryKey: projectEventsKey(projectId) });
	}
	client.invalidateQueries({ queryKey: instanceKey });
	client.invalidateQueries({ queryKey: instanceEventsKey });
}
