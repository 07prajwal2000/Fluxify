import { httpClient } from "@/lib/http";
import { responseSchema as getByIdResponseSchema } from "@fluxify/server/src/api/v1/integrations/get-by-id/dto";
import { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/integrations/get-all/dto";
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

const baseUrl = "/v1/integrations";

export const integrationService = {
	async getAll(
		group: string,
		tags?: string[],
	): Promise<z.infer<typeof getAllResponseSchema>> {
		let url = `${baseUrl}/list/${group}`;
		if (tags && tags.length > 0) {
			url += `?tags=${tags.join(",")}`;
		}
		const res = await httpClient.get(url);
		return res.data;
	},
	async getById(id: string): Promise<z.infer<typeof getByIdResponseSchema>> {
		const res = await httpClient.get(`${baseUrl}/${id}`);
		return res.data;
	},
	async create(
		data: z.infer<typeof createRequestSchema>,
	): Promise<z.infer<typeof createResponseSchema>> {
		const res = await httpClient.post(baseUrl, data);
		return res.data;
	},
	async update(
		id: string,
		data: z.infer<typeof updateRequestSchema>,
	): Promise<z.infer<typeof updateResponseSchema>> {
		const res = await httpClient.put(`${baseUrl}/${id}`, data);
		return res.data;
	},
	async delete(id: string): Promise<void> {
		await httpClient.delete(`${baseUrl}/${id}`);
	},
	async testExistingConnection(
		id: string,
	): Promise<z.infer<typeof testExistingConnectionResponseSchema>> {
		return await httpClient.get(`${baseUrl}/test-existing-connection/${id}`);
	},
	async testConnection(
		group: string,
		variant: string,
		config: any,
	): Promise<z.infer<typeof testConnectionResponseSchema>> {
		const res = await httpClient.post(`${baseUrl}/test-connection`, {
			group,
			variant,
			config,
		});
		return res.data;
	},
	createRequestSchema,
	updateRequestSchema,
};
