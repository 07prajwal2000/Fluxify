import z from "zod";
import { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/custom-blocks/get-all/dto";
import {
	requestBodySchema as createRequestSchema,
	responseSchema as createResponseSchema,
} from "@fluxify/server/src/api/v1/custom-blocks/create/dto";
import { httpClient } from "@/lib/http";
import { canvasEndpoints } from "./canvas";

const baseUrl = "/v1/custom-blocks";

export const customBlocksService = {
	async getAll(projectId: string): Promise<z.infer<typeof getAllResponseSchema>> {
		const result = await httpClient.get(`${baseUrl}/list?projectId=${projectId}`);
		return result.data;
	},
	async create(
		data: z.infer<typeof createRequestSchema>,
	): Promise<z.infer<typeof createResponseSchema>> {
		const result = await httpClient.post(baseUrl, data);
		return result.data;
	},
	async delete(id: string) {
		await httpClient.delete(`${baseUrl}/${id}`);
	},
	// a custom block's canvas is stored and served exactly like a route's
	...canvasEndpoints(baseUrl),
	createRequestSchema,
};
