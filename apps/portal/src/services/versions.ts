import type {
	checkoutBodySchema,
	checkoutResultSchema,
	commitBodySchema,
	versionDetailSchema,
	versionListSchema,
	versionSchema,
} from "@fluxify/server/src/modules/versions/dto";
import type z from "zod";
import { httpClient } from "@/lib/http";

export type VersionKind = "route" | "workflow" | "custom_block" | "middleware";
export type Version = z.infer<typeof versionSchema>;
export type VersionList = z.infer<typeof versionListSchema>;
export type VersionDetail = z.infer<typeof versionDetailSchema>;
export type CommitBody = z.input<typeof commitBodySchema>;
export type CheckoutBody = z.input<typeof checkoutBodySchema>;
export type CheckoutResult = z.infer<typeof checkoutResultSchema>;

/**
 * The URL segment each kind lives under (#738, #740). All four kinds share one
 * history and one deploy contract, so the only thing that varies is this, and
 * the versions, deployments and references services read it from here too.
 */
export const KIND_SEGMENT: Record<VersionKind, string> = {
	route: "routes",
	workflow: "workflows",
	custom_block: "custom-blocks",
	middleware: "middlewares",
};

/** A target's history hangs off `/v1/<segment>/<id>/versions`. */
const base = (kind: VersionKind, id: string) => `/v1/${KIND_SEGMENT[kind]}/${id}/versions`;

export const versionsService = {
	async list(kind: VersionKind, id: string): Promise<VersionList> {
		return (await httpClient.get(base(kind, id))).data;
	},
	async get(kind: VersionKind, id: string, versionId: string): Promise<VersionDetail> {
		return (await httpClient.get(`${base(kind, id)}/${versionId}`)).data;
	},
	/** 409 when nothing changed since the last version */
	async commit(kind: VersionKind, id: string, body: CommitBody): Promise<Version> {
		return (await httpClient.post(base(kind, id), body)).data;
	},
	/** uncommitted work is saved first, under `body.title`; 409 when the path and method are taken */
	async checkout(
		kind: VersionKind,
		id: string,
		versionId: string,
		body: CheckoutBody,
	): Promise<CheckoutResult> {
		return (await httpClient.post(`${base(kind, id)}/${versionId}/checkout`, body)).data;
	},
};
