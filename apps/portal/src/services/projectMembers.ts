import z from "zod";
import { responseSchema as listResponseSchema } from "@fluxify/server/src/api/v1/projects/settings/members/list/dto";
import { requestBodySchema as updateRequestBodySchema } from "@fluxify/server/src/api/v1/projects/settings/members/update/dto";
import { httpClient } from "@/lib/http";

const base = (projectId: string) => `/v1/projects/${projectId}/settings/members`;

export const projectMembersService = {
	async list(
		projectId: string,
		query: { page?: number; perPage?: number },
	): Promise<z.infer<typeof listResponseSchema>> {
		const params = new URLSearchParams();
		params.set("page", String(query?.page ?? 1));
		params.set("perPage", String(query?.perPage ?? 20));
		const res = await httpClient.get(`${base(projectId)}/list?${params}`);
		return res.data;
	},
	async update(
		projectId: string,
		userId: string,
		body: z.infer<typeof updateRequestBodySchema>,
	) {
		const res = await httpClient.put(`${base(projectId)}/update/${userId}`, body);
		return res.data;
	},
	async remove(projectId: string, userId: string): Promise<void> {
		await httpClient.delete(`${base(projectId)}/remove/${userId}`);
	},
	updateRequestBodySchema,
};
