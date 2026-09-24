import type {
	installRequestSchema,
	packagesResponseSchema,
	removeRequestSchema,
	statusResponseSchema,
	updatesResponseSchema,
} from "@fluxify/server/src/api/v1/projects/settings/packages/dto";
import type z from "zod";
import { httpClient } from "@/lib/http";

export type PackagesView = z.infer<typeof packagesResponseSchema>;
export type PackagesStatus = z.infer<typeof statusResponseSchema>;
export type PackageUpdate = z.infer<typeof updatesResponseSchema>[number];

const base = (projectId: string) => `/v1/projects/${projectId}/settings/packages`;

export const projectPackagesService = {
	async list(projectId: string): Promise<PackagesView> {
		return (await httpClient.get(base(projectId))).data;
	},
	async install(
		projectId: string,
		body: z.infer<typeof installRequestSchema>,
	): Promise<PackagesView> {
		return (await httpClient.post(`${base(projectId)}/install`, body)).data;
	},
	async remove(
		projectId: string,
		body: z.infer<typeof removeRequestSchema>,
	): Promise<PackagesView> {
		return (await httpClient.post(`${base(projectId)}/remove`, body)).data;
	},
	async updates(projectId: string): Promise<PackageUpdate[]> {
		return (await httpClient.get(`${base(projectId)}/updates`)).data;
	},
	async status(projectId: string): Promise<PackagesStatus> {
		return (await httpClient.get(`${base(projectId)}/status`)).data;
	},
};
