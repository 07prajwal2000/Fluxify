import type { DbService } from "../internal/dbService";
import type { WorkflowMetadata } from "../types";
import { createFindResourceTool } from "./findResource";
import { createGetArtifactTool } from "./getArtifact";
import { createGetRouteDetailsTool } from "./getRouteDetails";
import { searchDocsTool } from "./searchDocs";

export function createHarnessTools(dbService: DbService, metadata: WorkflowMetadata) {
	return [
		searchDocsTool,
		createGetRouteDetailsTool(dbService, metadata),
		createFindResourceTool(dbService, metadata),
		createGetArtifactTool(dbService, metadata),
	];
}
