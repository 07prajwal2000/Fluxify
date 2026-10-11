import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type CheckoutBody,
	type CommitBody,
	type VersionKind,
	versionsService,
} from "@/services/versions";

const root = (kind: VersionKind, id: string) => [kind === "route" ? "routes" : "workflows", id];
const listKey = (kind: VersionKind, id: string) => [...root(kind, id), "versions"];

/** What a commit leaves stale: the history and the head. A checkout also replaces the canvas. */
function useRefresh(kind: VersionKind, id: string, canvas: boolean) {
	const qc = useQueryClient();
	return () =>
		Promise.all(
			[
				listKey(kind, id),
				[...root(kind, id), "by-id"],
				...(canvas ? [[...root(kind, id), "canvas-items"]] : []),
			].map((queryKey) => qc.invalidateQueries({ queryKey })),
		);
}

export const versionsQuery = {
	list: {
		useQuery(kind: VersionKind, id: string) {
			return useQuery({
				queryKey: listKey(kind, id),
				queryFn: () => versionsService.list(kind, id),
				enabled: Boolean(id),
				refetchOnWindowFocus: false,
			});
		},
	},
	get: {
		useQuery(kind: VersionKind, id: string, versionId: string | undefined) {
			return useQuery({
				queryKey: [...listKey(kind, id), versionId],
				queryFn: () => versionsService.get(kind, id, versionId as string),
				enabled: Boolean(id && versionId),
				refetchOnWindowFocus: false,
			});
		},
	},
	commit: {
		mutation(kind: VersionKind, id: string) {
			const refresh = useRefresh(kind, id, false);
			return useMutation({
				mutationFn: (body: CommitBody) => versionsService.commit(kind, id, body),
				onSuccess: refresh,
			});
		},
	},
	checkout: {
		mutation(kind: VersionKind, id: string) {
			const refresh = useRefresh(kind, id, true);
			return useMutation({
				mutationFn: ({ versionId, ...body }: CheckoutBody & { versionId: string }) =>
					versionsService.checkout(kind, id, versionId, body),
				onSuccess: refresh,
			});
		},
	},
};
