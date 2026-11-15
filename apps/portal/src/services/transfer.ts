import type {
	importCheckResultSchema,
	importResultSchema,
} from "@fluxify/server/src/api/v1/transfer/dto";
import type { RouteBundle } from "@fluxify/server/src/modules/transfer/handlers/route";
import type { WorkflowBundle } from "@fluxify/server/src/modules/transfer/handlers/workflow";
import type z from "zod";
import { httpClient } from "@/lib/http";

export type { RouteBundle, WorkflowBundle };
export type ResourceType = "route" | "workflow";
export type BundleOf<T extends ResourceType> = T extends "route" ? RouteBundle : WorkflowBundle;
export type ImportConflicts = z.infer<typeof importCheckResultSchema>;
export type ImportResult = z.infer<typeof importResultSchema>;

const url = (type: ResourceType, rest: string) => `/v1/transfer/${type}/${rest}`;

export const transferService = {
	/** The resource as a portable bundle; `includeTests: false` leaves its test suites out. */
	async export<T extends ResourceType>(
		type: T,
		id: string,
		includeTests: boolean,
	): Promise<BundleOf<T>> {
		const result = await httpClient.get(url(type, `${id}/export`), { params: { includeTests } });
		return result.data;
	},
	/** What importing this bundle would clash with in the project; changes nothing. */
	async checkImport<T extends ResourceType>(
		type: T,
		projectId: string,
		bundle: BundleOf<T>,
	): Promise<ImportConflicts> {
		const result = await httpClient.post(url(type, "import/check"), { projectId, bundle });
		return result.data;
	},
	/** Creates the resource (canvas and tests included); `warnings` lists what was left out. */
	async import<T extends ResourceType>(
		type: T,
		projectId: string,
		bundle: BundleOf<T>,
	): Promise<ImportResult> {
		const result = await httpClient.post(url(type, "import"), { projectId, bundle });
		return result.data;
	},
};
