import {
	useInfiniteQuery,
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";
import {
	harnessConversationsService,
	type ListHarnessConversationsQuery,
} from "@/services/harnessConversations";

const key = (projectId: string) => ["harness-conversations", projectId];

/**
 * Applying an output writes real routes, custom blocks and canvases over the
 * bus, so every view of the project is stale — not just the conversation.
 * Both key roots are prefixes (`["routes", …]`, `["custom-blocks", …]`), so
 * one call each covers the list, the by-id read and the canvas items.
 */
function invalidateApplied(qc: ReturnType<typeof useQueryClient>, projectId: string) {
	qc.invalidateQueries({ queryKey: key(projectId) });
	qc.invalidateQueries({ queryKey: ["routes"] });
	qc.invalidateQueries({ queryKey: ["custom-blocks"] });
}

export const harnessConversationsQuery = {
	list: {
		useQuery(projectId: string, query: Partial<ListHarnessConversationsQuery> = {}) {
			const resolvedQuery: ListHarnessConversationsQuery = {
				page: query.page ?? 1,
				perPage: query.perPage ?? 20,
				needUserQuery: query.needUserQuery ?? false,
				archived: query.archived ?? false,
				pinned: query.pinned,
				search: query.search,
			};
			return useQuery({
				queryKey: [...key(projectId), "list", resolvedQuery],
				queryFn: () => harnessConversationsService.list(projectId, resolvedQuery),
				refetchOnWindowFocus: false,
			});
		},
		/** Paginated variant for the sidebar — flatten `data.pages[].data`. */
		useInfiniteQuery(
			projectId: string,
			query: Omit<Partial<ListHarnessConversationsQuery>, "page"> = {},
		) {
			const base = {
				perPage: query.perPage ?? 20,
				needUserQuery: query.needUserQuery ?? false,
				archived: query.archived ?? false,
				pinned: query.pinned,
				search: query.search,
			};
			return useInfiniteQuery({
				queryKey: [...key(projectId), "list-infinite", base],
				queryFn: ({ pageParam }) =>
					harnessConversationsService.list(projectId, { ...base, page: pageParam }),
				initialPageParam: 1,
				getNextPageParam: (last) =>
					last.pagination.hasNext ? last.pagination.page + 1 : undefined,
				refetchOnWindowFocus: false,
			});
		},
	},
	messages: {
		/** Cursor-paginated history. Each page is already oldest-first, so older
		 *  pages prepend: `[...data.pages].reverse().flatMap((p) => p.messages)`. */
		useInfiniteQuery(projectId: string, conversationId: string) {
			return useInfiniteQuery({
				queryKey: [...key(projectId), conversationId, "messages"],
				queryFn: ({ pageParam }) =>
					harnessConversationsService.listMessages(
						projectId,
						conversationId,
						pageParam,
					),
				initialPageParam: undefined as string | undefined,
				getNextPageParam: (last) => last.pagination.nextCursor ?? undefined,
				enabled: Boolean(conversationId),
				refetchOnWindowFocus: false,
			});
		},
	},
	update: {
		mutation(projectId: string, conversationId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (
					body: z.infer<typeof harnessConversationsService.updateRequestBodySchema>,
				) => harnessConversationsService.update(projectId, conversationId, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
	remove: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (conversationId: string) =>
					harnessConversationsService.delete(projectId, conversationId),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
	sendMessage: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (
					body: z.infer<typeof harnessConversationsService.sendMessageRequestBodySchema>,
				) => harnessConversationsService.sendMessage(projectId, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
	subArtifacts: {
		/** Chips for one run's outputs. Applying anything invalidates this. */
		useQuery(projectId: string, conversationId: string, runId: string) {
			return useQuery({
				queryKey: [...key(projectId), conversationId, "sub-artifacts", runId],
				queryFn: () =>
					harnessConversationsService.listRunSubArtifacts(
						projectId,
						conversationId,
						runId,
					),
				enabled: Boolean(conversationId && runId),
				refetchOnWindowFocus: false,
			});
		},
		/** One output with its `payload` — only fetch when the panel opens. */
		useDetailQuery(
			projectId: string,
			conversationId: string,
			subArtifactId: string | null,
		) {
			return useQuery({
				queryKey: [...key(projectId), conversationId, "sub-artifact", subArtifactId],
				queryFn: () =>
					harnessConversationsService.getSubArtifact(
						projectId,
						conversationId,
						subArtifactId as string,
					),
				enabled: Boolean(conversationId && subArtifactId),
				refetchOnWindowFocus: false,
			});
		},
		/** Several outputs at once — used to link a canvas to its route, which
		 *  only the payloads know. Shares the detail cache keys. */
		useDetailsQuery(projectId: string, conversationId: string, ids: string[]) {
			return useQueries({
				queries: ids.map((id) => ({
					queryKey: [...key(projectId), conversationId, "sub-artifact", id],
					queryFn: () =>
						harnessConversationsService.getSubArtifact(projectId, conversationId, id),
					enabled: Boolean(conversationId && id),
					refetchOnWindowFocus: false,
				})),
			});
		},
	},
	applySubArtifact: {
		mutation(projectId: string, conversationId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (subArtifactId: string) =>
					harnessConversationsService.applySubArtifact(
						projectId,
						conversationId,
						subArtifactId,
					),
				onSuccess: () => invalidateApplied(qc, projectId),
			});
		},
	},
	applyArtifact: {
		mutation(projectId: string, conversationId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (artifactId: string) =>
					harnessConversationsService.applyArtifact(
						projectId,
						conversationId,
						artifactId,
					),
				onSuccess: () => invalidateApplied(qc, projectId),
			});
		},
	},
	action: {
		mutation(projectId: string, conversationId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (
					body: z.infer<typeof harnessConversationsService.actionRequestBodySchema>,
				) => harnessConversationsService.action(projectId, conversationId, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
};
