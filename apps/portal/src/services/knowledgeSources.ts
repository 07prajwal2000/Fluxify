import { httpClient } from "@/lib/http";

export type KnowledgeSourceType = "markdown" | "url" | "llms_txt" | "llms_full_txt";

export interface KnowledgePage {
	url?: string;
	markdown: string;
	edited?: boolean;
}

export interface KnowledgeSourceSummary {
	id: string;
	name: string;
	type: KnowledgeSourceType;
	url: string | null;
	headers: Record<string, string>;
	selectedPages: string[];
	enabled: boolean;
	pageCount: number;
	editedCount?: number;
	lastFetchedAt: string | null;
	lastFetchStatus: string | null;
	lastFetchError: string | null;
}

export interface KnowledgeSourceDetail extends KnowledgeSourceSummary {
	pages: KnowledgePage[];
}

export interface CreateKnowledgeSourceBody {
	name: string;
	type: KnowledgeSourceType;
	content?: string;
	url?: string;
	headers?: Record<string, string>;
	selectedPages?: string[];
	enabled?: boolean;
}

export type UpdateKnowledgeSourceBody = CreateKnowledgeSourceBody;

export interface PreviewLlmsBody {
	url: string;
	headers?: Record<string, string>;
}

export interface PreviewLlmsResponse {
	pages: Array<{ title: string; url: string }>;
}

const baseUrl = (projectId: string) => `/v1/${projectId}/knowledge-sources`;

export const knowledgeSourcesService = {
	async list(projectId: string): Promise<KnowledgeSourceSummary[]> {
		const res = await httpClient.get(baseUrl(projectId));
		return res.data;
	},

	async get(projectId: string, id: string): Promise<KnowledgeSourceDetail> {
		const res = await httpClient.get(`${baseUrl(projectId)}/${id}`);
		return res.data;
	},

	async create(projectId: string, body: CreateKnowledgeSourceBody): Promise<{ id: string }> {
		const res = await httpClient.post(baseUrl(projectId), body);
		return res.data;
	},

	async update(
		projectId: string,
		id: string,
		body: UpdateKnowledgeSourceBody,
	): Promise<{ id: string }> {
		const res = await httpClient.put(`${baseUrl(projectId)}/${id}`, body);
		return res.data;
	},

	async refetch(projectId: string, id: string): Promise<KnowledgeSourceDetail> {
		const res = await httpClient.post(`${baseUrl(projectId)}/${id}/refetch`);
		return res.data;
	},

	async remove(projectId: string, id: string): Promise<{ id: string }> {
		const res = await httpClient.delete(`${baseUrl(projectId)}/${id}`);
		return res.data;
	},

	async updatePage(
		projectId: string,
		id: string,
		index: number,
		body: { markdown: string },
	): Promise<{ id: string }> {
		const res = await httpClient.put(`${baseUrl(projectId)}/${id}/pages/${index}`, body);
		return res.data;
	},

	async previewLlms(projectId: string, body: PreviewLlmsBody): Promise<PreviewLlmsResponse> {
		const res = await httpClient.post(`${baseUrl(projectId)}/llms-txt/preview`, body);
		return res.data;
	},
};
