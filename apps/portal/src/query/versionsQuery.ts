import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type CheckoutBody,
	type CommitBody,
	KIND_SEGMENT,
	type VersionKind,
	versionsService,
} from "@/services/versions";

/** the query-key prefix a target's versions and detail live under (#740) */
export const versionRoot = (kind: VersionKind, id: string) => [KIND_SEGMENT[kind], id];
const listKey = (kind: VersionKind, id: string) => [...versionRoot(kind, id), "versions"];

/**
 * What a commit or a checkout leaves stale. A commit moves the history and the
 * head only. A checkout also replaces the canvas and the settings, so everything
 * that shows them is read again: the canvas, the detail, the lists (the switcher
 * and the list pages show name and, for routes, path and method), a route's
 * middlewares and the last compile result. Inactive queries are refetched too, so
 * the canvas page is fresh by the time it is opened, not after a flash of the old
 * one.
 */
function useRefresh(kind: VersionKind, id: string, checkout: boolean) {
	const qc = useQueryClient();
	const segment = KIND_SEGMENT[kind];
	return () => {
		const keys = [
			listKey(kind, id),
			[segment, id, "by-id"],
			...(checkout
				? [
						[segment, id, "canvas-items"],
						[segment, id, "response-schemas"],
						[segment, "list"],
						["middlewares"],
					]
				: []),
		];
		return Promise.all([
			...keys.map((queryKey) => qc.invalidateQueries({ queryKey, refetchType: "all" })),
			checkout
				? qc.invalidateQueries({
						// the compile result of this target: ["system-logs", project, "compile", type, id]
						predicate: ({ queryKey: key }) =>
							key[0] === "system-logs" && key[2] === "compile" && key[4] === id,
						refetchType: "all",
					})
				: undefined,
		]);
	};
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
