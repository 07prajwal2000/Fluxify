import type z from "zod";
import type { AuthACL } from "../../../../db/schema";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { acceptedContentTypes, bodyModeOf } from "../../../../lib/routeConfig";
import { versionNumberOf } from "../../../../modules/versions/repository";
import { hasUncommitted } from "../../../../modules/versions/state";
import type { responseSchema } from "./dto";
import { getRouteById } from "./repository";

export default async function handleRequest(
	id: string,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof responseSchema>> {
	const route = await getRouteById(id);
	if (!route) {
		throw new NotFoundError("no route found with id: " + id);
	}
	const hasAccess = acl.some((a) => a.projectId === route.projectId || a.projectId === "*");
	if (!hasAccess) {
		throw new ForbiddenError();
	}
	return {
		id: route.id,
		name: route.name!,
		path: route.path!,
		active: route.active!,
		devActive: route.devActive,
		projectId: route.projectId!,
		method: route.method!,
		createdBy: route.createdBy!,
		createdAt: route.createdAt.toISOString(),
		updatedAt: route.updatedAt.toISOString(),
		projectName: route.projectName!,
		bodySchema: route.bodySchema,
		querySchema: route.querySchema,
		paramsSchema: route.paramsSchema,
		timeoutSeconds: route.timeoutSeconds,
		tracingEnabled: route.tracingEnabled,
		recordExecution: route.recordExecution,
		devTracingEnabled: route.devTracingEnabled,
		devRecordExecution: route.devRecordExecution,
		acceptedContentTypes: acceptedContentTypes(route.routeConfig),
		bodyMode: bodyModeOf(route.routeConfig),
		headVersionNumber: await versionNumberOf(route.headVersionId),
		prodVersionId: route.prodVersionId,
		prodVersionNumber: await versionNumberOf(route.prodVersionId),
		uncommitted: hasUncommitted(route),
	};
}
