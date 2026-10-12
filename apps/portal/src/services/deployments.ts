import type {
	deployBodySchema,
	deploymentListSchema,
	deploymentSchema,
} from "@fluxify/server/src/modules/deployments/dto";
import type z from "zod";
import { httpClient } from "@/lib/http";
import { KIND_SEGMENT, type VersionKind } from "./versions";

export type Deployment = z.infer<typeof deploymentSchema>;
export type DeploymentList = z.infer<typeof deploymentListSchema>;
export type DeploymentGate = Deployment["gates"][number];
export type DeployGateRef = NonNullable<DeploymentGate["refs"]>[number];
export type DeployBody = z.input<typeof deployBodySchema>;

/** A promote and a rollback are the same call on the same path; the server tells them apart. */
const base = (kind: VersionKind, id: string) => `/v1/${KIND_SEGMENT[kind]}/${id}/deployments`;

export const deploymentsService = {
	/** the log, newest first */
	async list(kind: VersionKind, id: string): Promise<DeploymentList> {
		return (await httpClient.get(base(kind, id))).data;
	},
	/** one deployment, polled while it is pending */
	async get(kind: VersionKind, id: string, deploymentId: string): Promise<Deployment> {
		return (await httpClient.get(`${base(kind, id)}/${deploymentId}`)).data;
	},
	/** starts a promote or rollback; the answer is pending while the gates run */
	async deploy(kind: VersionKind, id: string, body: DeployBody): Promise<Deployment> {
		return (await httpClient.post(base(kind, id), body)).data;
	},
};
