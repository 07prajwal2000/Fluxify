import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentReviewsService, type ReviewKind } from "@/services/agentReviews";

const key = (projectId: string, kind: ReviewKind, id: string) => [
	"agent-reviews",
	projectId,
	kind,
	id,
];
/** While a review runs; its result lands in a few seconds to a minute. */
const RUNNING_POLL_MS = 3000;
/** Otherwise, often enough to notice a save made the report stale. */
const IDLE_POLL_MS = 15_000;

export const agentReviewsQuery = {
	latest: {
		useQuery(projectId: string, kind: ReviewKind, id: string) {
			return useQuery({
				queryKey: key(projectId, kind, id),
				queryFn: () => agentReviewsService.get(projectId, kind, id),
				refetchInterval: (q) =>
					q.state.data?.status === "running" ? RUNNING_POLL_MS : IDLE_POLL_MS,
			});
		},
	},
	start: {
		mutation(projectId: string, kind: ReviewKind, id: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: () => agentReviewsService.start(projectId, kind, id),
				onSuccess: (review) => qc.setQueryData(key(projectId, kind, id), review),
			});
		},
	},
	stop: {
		mutation(projectId: string, kind: ReviewKind, id: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: () => agentReviewsService.stop(projectId, kind, id),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId, kind, id) }),
			});
		},
	},
};
