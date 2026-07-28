import type { WorkflowMetadata } from "../types";
import type { DbService } from "../internal/dbService";
import { searchDocsTool } from "./searchDocs";
import { createGetRouteDetailsTool } from "./getRouteDetails";
import { createFindResourceTool } from "./findResource";
import { createGetArtifactTool } from "./getArtifact";

export function createHarnessTools(
	dbService: DbService,
	metadata: WorkflowMetadata,
) {
	return [
		searchDocsTool,
		createGetRouteDetailsTool(dbService, metadata),
		createFindResourceTool(dbService, metadata),
		createGetArtifactTool(dbService, metadata),
	];
}
