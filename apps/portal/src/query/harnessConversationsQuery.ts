import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type { z } from "zod";
import {
	harnessConversationsService,
	type ListHarnessConversationsQuery,
} from "@/services/harnessConversations";

const key = (projectId: string) => ["harness-conversations", projectId];

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
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
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
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
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
