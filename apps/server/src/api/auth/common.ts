import { getCache, deleteCacheKey } from "../../db/redis";
import { User } from "better-auth";
import { AccessControlRole, AuthACL } from "../../db/schema";
import { canAccess, canAccessProject } from "../../lib/acl";
import { auth } from "../../lib/auth";

export async function revokeSessions(userId: string) {
	const sessions = JSON.parse(
		(await getCache(`active-sessions-${userId}`)) || "[]",
	) as {
		token: string;
	}[];
	for (const session of sessions) {
		await deleteCacheKey(session.token);
	}
}

export function hasAdminAccess(
	user?: (User & { isSystemAdmin: boolean }) | null,
	systemAccessKey?: string,
): boolean {
	return !!(
		user?.isSystemAdmin ||
		(systemAccessKey && systemAccessKey === process.env.SYSTEM_ACCESS_KEY)
	);
}

export function hasRoleAccess(
	user: (User & { isSystemAdmin: boolean }) | null | undefined,
	acl: AuthACL[] | null | undefined,
	requiredRole: AccessControlRole,
): boolean {
	if (user?.isSystemAdmin) {
		return true;
	}
	if (!acl) {
		return false;
	}
	return canAccess(acl, requiredRole);
}

export function hasProjectAccess(
	user: (User & { isSystemAdmin: boolean }) | null | undefined,
	acl: AuthACL[] | null | undefined,
	projectId: string,
	requiredRole: AccessControlRole,
): boolean {
	if (user?.isSystemAdmin) {
		return true;
	}
	if (!acl) {
		return false;
	}
	return canAccessProject(acl, projectId, requiredRole);
}
