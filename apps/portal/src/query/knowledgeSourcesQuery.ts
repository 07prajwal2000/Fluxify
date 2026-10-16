import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type CreateKnowledgeSourceBody,
	knowledgeSourcesService,
	type PreviewLlmsBody,
	type UpdateKnowledgeSourceBody,
} from "@/services/knowledgeSources";

const key = (projectId: string) => ["knowledge-sources", projectId];
const detailKey = (projectId: string, id: string) => ["knowledge-sources", projectId, id];

export const knowledgeSourcesQuery = {
	getAll: {
		useQuery(projectId: string) {
			return useQuery({
				queryKey: key(projectId),
				queryFn: () => knowledgeSourcesService.list(projectId),
				refetchOnWindowFocus: false,
			});
		},
	},
	getById: {
		useQuery(projectId: string, id: string | null | undefined) {
			return useQuery({
				queryKey: detailKey(projectId, id ?? ""),
				queryFn: () => knowledgeSourcesService.get(projectId, id as string),
				enabled: Boolean(projectId && id),
				refetchOnWindowFocus: false,
			});
		},
	},
	create: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: CreateKnowledgeSourceBody) =>
					knowledgeSourcesService.create(projectId, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
		useMutation(projectId: string) {
			return knowledgeSourcesQuery.create.mutation(projectId);
		},
	},
	update: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: ({ id, body }: { id: string; body: UpdateKnowledgeSourceBody }) =>
					knowledgeSourcesService.update(projectId, id, body),
				onSuccess: (_, { id }) => {
					qc.invalidateQueries({ queryKey: key(projectId) });
					qc.invalidateQueries({ queryKey: detailKey(projectId, id) });
				},
			});
		},
		useMutation(projectId: string) {
			return knowledgeSourcesQuery.update.mutation(projectId);
		},
	},
	refetch: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (id: string) => knowledgeSourcesService.refetch(projectId, id),
				onSuccess: (_, id) => {
					qc.invalidateQueries({ queryKey: key(projectId) });
					qc.invalidateQueries({ queryKey: detailKey(projectId, id) });
				},
			});
		},
		useMutation(projectId: string) {
			return knowledgeSourcesQuery.refetch.mutation(projectId);
		},
	},
	remove: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (id: string) => knowledgeSourcesService.remove(projectId, id),
				onSuccess: (_, id) => {
					qc.invalidateQueries({ queryKey: key(projectId) });
					qc.removeQueries({ queryKey: detailKey(projectId, id) });
				},
			});
		},
		useMutation(projectId: string) {
			return knowledgeSourcesQuery.remove.mutation(projectId);
		},
	},
	previewLlms: {
		mutation(projectId: string) {
			return useMutation({
				mutationFn: (body: PreviewLlmsBody) => knowledgeSourcesService.previewLlms(projectId, body),
			});
		},
		useMutation(projectId: string) {
			return knowledgeSourcesQuery.previewLlms.mutation(projectId);
		},
	},
	updatePage: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: ({
					id,
					index,
					body,
				}: {
					id: string;
					index: number;
					body: { markdown: string };
				}) => knowledgeSourcesService.updatePage(projectId, id, index, body),
				onSuccess: (_, { id }) => {
					qc.invalidateQueries({ queryKey: key(projectId) });
					qc.invalidateQueries({ queryKey: detailKey(projectId, id) });
				},
			});
		},
		useMutation(projectId: string) {
			return knowledgeSourcesQuery.updatePage.mutation(projectId);
		},
	},
};
