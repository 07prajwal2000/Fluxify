import z from "zod";
import { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/instance-settings/get-all/dto";
import { requestBodySchema as upsertRequestBodySchema } from "@fluxify/server/src/api/v1/instance-settings/upsert/dto";
import { responseSchema as getAuthResponseSchema } from "@fluxify/server/src/api/v1/instance-settings/get-auth-settings/dto";
import {
	requestBodySchema as patchAuthRequestBodySchema,
	responseSchema as patchAuthResponseSchema,
} from "@fluxify/server/src/api/v1/instance-settings/patch-auth-settings/dto";
import { httpClient } from "@/lib/http";

const baseUrl = "/v1/instance-settings";

export const instanceSettingsService = {
	async getAll(): Promise<z.infer<typeof getAllResponseSchema>> {
		const result = await httpClient.get(baseUrl);
		return result.data;
	},
	async upsert(body: z.infer<typeof upsertRequestBodySchema>) {
		const result = await httpClient.put(baseUrl, body);
		return result.data;
	},
	async getAuth(): Promise<z.infer<typeof getAuthResponseSchema>> {
		const result = await httpClient.get(`${baseUrl}/auth`);
		return result.data;
	},
	async patchAuth(
		body: z.infer<typeof patchAuthRequestBodySchema>,
	): Promise<z.infer<typeof patchAuthResponseSchema>> {
		const result = await httpClient.patch(`${baseUrl}/auth`, body);
		return result.data;
	},
};
