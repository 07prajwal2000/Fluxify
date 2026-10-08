import { ForbiddenError } from "../../../../../../errors/forbidError";
import { hasProjectAccess } from "../../../../../auth/common";
import { adminOnlyProjectSettingKeys } from "../keySchemaMap";

/** The route lets creators in; a few keys (agent limits) need a project admin on top. */
export function assertCanWriteKey(
	user: Parameters<typeof hasProjectAccess>[0],
	acl: Parameters<typeof hasProjectAccess>[1],
	projectId: string,
	key: string,
) {
	if (
		adminOnlyProjectSettingKeys.has(key) &&
		!hasProjectAccess(user, acl, projectId, "project_admin")
	) {
		throw new ForbiddenError("Only a project admin can change this setting");
	}
}
