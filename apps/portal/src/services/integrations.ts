import type z from "zod";
import { responseSchema as getBasicListResponseSchema } from "@fluxify/server/src/api/v1/integrations/get-basic-list/dto";
import { httpClient } from "@/lib/http";

const base = (projectId: string) => `/v1/${projectId}/integrations`;

// Typed locally rather than importing the create DTO: that DTO pulls in
// integration schemas -> @fluxify/adapters, which drags adapter type-only
// import violations into the portal typecheck. Server validates the body.
export type CreateIntegrationBody = {
	name: string;
	group: string;
	variant: string;
	config: Record<string, unknown>;
};

export const integrationsService = {
	async getBasicList(
		projectId: string,
	): Promise<z.infer<typeof getBasicListResponseSchema>> {
		const res = await httpClient.get(`${base(projectId)}/list-basic`);
		return res.data;
	},
	async create(
		projectId: string,
		body: CreateIntegrationBody,
	): Promise<{ id: string }> {
		const res = await httpClient.post(base(projectId), body);
		return res.data;
	},
	async delete(projectId: string, id: string): Promise<void> {
		await httpClient.delete(`${base(projectId)}/${id}`);
	},
};
