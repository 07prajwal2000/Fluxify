import type {
	createdSchema,
	createSchema,
	listSchema,
	patchSchema,
	sandboxSchema,
} from "@fluxify/server/src/api/v1/sandboxes/dto";
import type { runAcceptedSchema } from "@fluxify/server/src/api/v1/workflows/dto";
import type z from "zod";
import { httpClient } from "@/lib/http";
import { canvasEndpoints } from "./canvas";

export type Sandbox = z.infer<typeof sandboxSchema>;
export type CreateSandboxBody = z.infer<typeof createSchema>;
export type UpdateSandboxBody = z.infer<typeof patchSchema>;

/** Every sandbox endpoint hangs off its project, so the project id is part of the call. */
export const sandboxesBase = (projectId: string) => `/v1/projects/${projectId}/sandboxes`;

/**
 * The sandbox side of the canvas contract: a sandbox's canvas is stored and
 * served exactly like a workflow's, under its own URL, so the one editor loads
 * and saves it with nothing but these three calls.
 */
export const sandboxCanvas = (projectId: string) => canvasEndpoints(sandboxesBase(projectId));

export const sandboxesService = {
	/** only the signed-in user's own */
	async list(projectId: string): Promise<z.infer<typeof listSchema>["data"]> {
		const result = await httpClient.get(`${sandboxesBase(projectId)}`);
		return result.data.data;
	},
	async getById(projectId: string, id: string): Promise<Sandbox> {
		const result = await httpClient.get(`${sandboxesBase(projectId)}/${id}`);
		return result.data;
	},
	async create(projectId: string, body: CreateSandboxBody): Promise<z.infer<typeof createdSchema>> {
		const result = await httpClient.post(`${sandboxesBase(projectId)}`, body);
		return result.data;
	},
	async update(projectId: string, id: string, body: UpdateSandboxBody): Promise<Sandbox> {
		const result = await httpClient.patch(`${sandboxesBase(projectId)}/${id}`, body);
		return result.data;
	},
	async delete(projectId: string, id: string) {
		await httpClient.delete(`${sandboxesBase(projectId)}/${id}`);
	},
	/** Queues one run as a workflow. 409 when no development worker is running. */
	async run(
		projectId: string,
		id: string,
		payload: unknown,
	): Promise<z.infer<typeof runAcceptedSchema>> {
		const result = await httpClient.post(`${sandboxesBase(projectId)}/${id}/run`, { payload });
		return result.data;
	},
	async devWorkerOnline(projectId: string): Promise<boolean> {
		const result = await httpClient.get(`/v1/projects/${projectId}/nodes/dev-worker`);
		return Boolean(result.data.online);
	},
};
