import type { AuthACL } from "../../db/schema";
import type { BundleSpec } from "./envelope";
import { routeHandler } from "./handlers/route";
import { workflowHandler } from "./handlers/workflow";

/** Add a type by adding its handler below; no endpoint changes. */
export const RESOURCE_TYPES = ["route", "workflow"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/** what an import would clash with in the project */
export type ConflictField = "name" | "path";

export interface TransferHandler<B = any> {
	spec: BundleSpec<B>;
	/** the project the resource lives in; throws `NotFoundError` when there is none */
	projectOf(id: string): Promise<string>;
	build(id: string, includeTests: boolean): Promise<B>;
	conflicts(projectId: string, bundle: B): Promise<ConflictField[]>;
	import(
		actor: { userId: string; acl: AuthACL[] },
		projectId: string,
		bundle: B,
	): Promise<{ id: string; warnings: string[] }>;
}

export const transferHandlers: Record<ResourceType, TransferHandler> = {
	route: routeHandler,
	workflow: workflowHandler,
};
