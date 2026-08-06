import { httpClient } from "@/lib/http";
import { responseSchema as getByIdResponseSchema } from "@fluxify/server/src/api/v1/integrations/get-by-id/dto";
import { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/integrations/get-all/dto";
import { responseSchema as getBasicListResponseSchema } from "@fluxify/server/src/api/v1/integrations/get-basic-list/dto";
import { responseSchema as getMetadataResponseSchema } from "@fluxify/server/src/api/v1/integrations/get-metadata/dto";
import {
	requestBodySchema as createRequestSchema,
	responseSchema as createResponseSchema,
} from "@fluxify/server/src/api/v1/integrations/create/dto";
import {
	requestBodySchema as updateRequestSchema,
	responseSchema as updateResponseSchema,
} from "@fluxify/server/src/api/v1/integrations/update/dto";
import { responseSchema as testConnectionResponseSchema } from "@fluxify/server/src/api/v1/integrations/test-connection/dto";
import { responseSchema as testExistingConnectionResponseSchema } from "@fluxify/server/src/api/v1/integrations/test-existing-connection/dto";
import z from "zod";

const getBaseUrl = (projectId: string) => `/v1/${projectId}/integrations`;

export const integrationService = {
	async getBasicList(
		projectId: string,
		useForHarness?: boolean,
	): Promise<z.infer<typeof getBasicListResponseSchema>> {
		const url = `${getBaseUrl(projectId)}/list-basic${useForHarness ? "?useForHarness=true" : ""}`;
		const res = await httpClient.get(url);
		return res.data;
	},
	async getAll(
		projectId: string,
		group: string,
		tags?: string[],
	): Promise<z.infer<typeof getAllResponseSchema>> {
		let url = `${getBaseUrl(projectId)}/list/${group}`;
		if (tags && tags.length > 0) {
			url += `?tags=${tags.join(",")}`;
		}
		const res = await httpClient.get(url);
		return res.data;
	},
	async getById(
		projectId: string,
		id: string,
	): Promise<z.infer<typeof getByIdResponseSchema>> {
		const res = await httpClient.get(`${getBaseUrl(projectId)}/${id}`);
		return res.data;
	},
	async create(
		projectId: string,
		data: z.infer<typeof createRequestSchema>,
	): Promise<z.infer<typeof createResponseSchema>> {
		const res = await httpClient.post(getBaseUrl(projectId), data);
		return res.data;
	},
	async update(
		projectId: string,
		id: string,
		data: z.infer<typeof updateRequestSchema>,
	): Promise<z.infer<typeof updateResponseSchema>> {
		const res = await httpClient.put(`${getBaseUrl(projectId)}/${id}`, data);
		return res.data;
	},
	async delete(projectId: string, id: string): Promise<void> {
		await httpClient.delete(`${getBaseUrl(projectId)}/${id}`);
	},
	async testExistingConnection(
		projectId: string,
		id: string,
		/** observability only — probes that signal's OTLP endpoint */
		signal?: "logs" | "traces" | "metrics",
	): Promise<z.infer<typeof testExistingConnectionResponseSchema>> {
		const res = await httpClient.get(
			`${getBaseUrl(projectId)}/test-existing-connection/${id}${signal ? `?signal=${signal}` : ""}`,
		);
		return res.data;
	},
	async testConnection(
		projectId: string,
		group: string,
		variant: string,
		config: unknown,
	): Promise<z.infer<typeof testConnectionResponseSchema>> {
		const res = await httpClient.post(`${getBaseUrl(projectId)}/test-connection`, {
			group,
			variant,
			config,
		});
		return res.data;
	},
	async getMetadata(
		projectId: string,
		integrationId: string,
	): Promise<z.infer<typeof getMetadataResponseSchema>> {
		const res = await httpClient.get(
			`${getBaseUrl(projectId)}/${integrationId}/metadata`,
		);
		return res.data;
	},
	createRequestSchema,
	updateRequestSchema,
};
