import type z from "zod";
import { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/projects/settings/keys/get-all/dto";
import type {
	RequestBodySchema as UpsertRequestBody,
	ResponseSchema as UpsertResponse,
} from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import { httpClient } from "@/lib/http";

const base = (projectId: string) => `/v1/projects/${projectId}/settings/keys`;

export const projectSettingsKeysService = {
	async getAll(
		projectId: string,
	): Promise<z.infer<typeof getAllResponseSchema>> {
		const res = await httpClient.get(`${base(projectId)}`);
		return res.data;
	},
	async upsert(
		projectId: string,
		body: UpsertRequestBody,
	): Promise<UpsertResponse> {
		const res = await httpClient.put(base(projectId), body);
		return res.data;
	},
};
