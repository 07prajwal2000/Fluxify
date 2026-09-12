import type {
	CreateClaimBody,
	CreateInstanceClaimBody,
	EventViewDto,
	OrchestrationStatusDto,
	PatchClaimBody,
} from "@fluxify/server/src/api/v1/orchestration/dto";
import { httpClient } from "@/lib/http";

/**
 * The two orchestration surfaces (#339). Same payload, two scopes: a project
 * owner asks for capacity, an operator sizes the pool it comes out of.
 *
 * Both are absent on a deployment with no orchestrator (Kit), where the
 * endpoints answer 404 — so callers gate on `orchestration.enabled` from
 * public settings rather than treating an error as a fault.
 */

export type OrchestrationStatus = OrchestrationStatusDto;
export type OrchestrationEvent = EventViewDto;
export type NodeView = OrchestrationStatusDto["claims"][number]["nodes"][number];
export type ClaimView = OrchestrationStatusDto["claims"][number];
export type { CreateClaimBody, CreateInstanceClaimBody, PatchClaimBody };

const projectBase = (projectId: string) => `/v1/projects/${projectId}/nodes`;
const instanceBase = "/v1/instance-settings/orchestration";

export const orchestrationService = {
	async getProject(projectId: string): Promise<OrchestrationStatus> {
		const res = await httpClient.get(projectBase(projectId));
		return res.data;
	},
	async getProjectEvents(projectId: string, limit = 25): Promise<OrchestrationEvent[]> {
		const res = await httpClient.get(`${projectBase(projectId)}/events?limit=${limit}`);
		return res.data;
	},
	async claim(projectId: string, body: CreateClaimBody) {
		const res = await httpClient.post(`${projectBase(projectId)}/claims`, body);
		return res.data as { id: string; message: string };
	},
	async updateProjectClaim(projectId: string, claimId: string, body: PatchClaimBody) {
		const res = await httpClient.patch(`${projectBase(projectId)}/claims/${claimId}`, body);
		return res.data as { id: string; message: string };
	},
	async releaseProjectClaim(projectId: string, claimId: string) {
		const res = await httpClient.delete(`${projectBase(projectId)}/claims/${claimId}`);
		return res.data as { id: string; message: string };
	},

	async getInstance(): Promise<OrchestrationStatus> {
		const res = await httpClient.get(instanceBase);
		return res.data;
	},
	async getInstanceEvents(limit = 50): Promise<OrchestrationEvent[]> {
		const res = await httpClient.get(`${instanceBase}/events?limit=${limit}`);
		return res.data;
	},
	async updateInstanceClaim(claimId: string, body: PatchClaimBody) {
		const res = await httpClient.patch(`${instanceBase}/claims/${claimId}`, body);
		return res.data as { id: string; message: string };
	},
	async releaseInstanceClaim(claimId: string) {
		const res = await httpClient.delete(`${instanceBase}/claims/${claimId}`);
		return res.data as { id: string; message: string };
	},
};
