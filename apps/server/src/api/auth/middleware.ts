import type { User } from "better-auth";
import type { Next } from "hono";
import type { AccessControlRole, AuthACL } from "../../db/schema";
import { ForbiddenError } from "../../errors/forbidError";
import { UnauthorizedError } from "../../errors/unauthorizedError";
import type { HonoContext } from "../../types";
import { hasAdminAccess, hasProjectAccess, hasRoleAccess } from "./common";

export async function requireSystemAdmin(ctx: HonoContext, next: Next) {
	const user = ctx.get("user") as User & { isSystemAdmin: boolean };
	const systemAccessKey = ctx.req.header("SYSTEM_ACCESS_KEY");
	if (hasAdminAccess(user, systemAccessKey)) {
		return next();
	}
	throw new ForbiddenError("Only system admins can access");
}

export function requireRoleAccess(requiredRole: AccessControlRole) {
	return async (ctx: HonoContext, next: Next) => {
		const user = ctx.get("user") as User & { isSystemAdmin: boolean };
		const acl = ctx.get("acl") as AuthACL[];
		if (!hasRoleAccess(user, acl, requiredRole)) {
			throw new ForbiddenError();
		}
		return next();
	};
}

export function requireLoggedIn() {
	return async (ctx: HonoContext, next: Next) => {
		const user = ctx.get("user") as User;
		if (!user) {
			throw new ForbiddenError();
		}
		return next();
	};
}

export function requireProjectAccess(
	requiredRole: AccessControlRole,
	projectId: string | { source: "param" | "query" | "header" | "body"; key: string },
) {
	return async (ctx: HonoContext, next: Next) => {
		let projectIdValue: string;
		if (typeof projectId === "string") {
			projectIdValue = projectId;
		} else {
			switch (projectId.source) {
				case "param":
					projectIdValue = ctx.req.param()[projectId.key];
					break;
				case "query":
					projectIdValue = ctx.req.query(projectId.key) || "";
					break;
				case "header":
					projectIdValue = ctx.req.header(projectId.key) || "";
					break;
				case "body":
					projectIdValue = (await ctx.req.json())[projectId.key];
					break;
			}
		}
		const user = ctx.get("user") as User & { isSystemAdmin: boolean };
		const acl = ctx.get("acl") as AuthACL[];
		if (!hasProjectAccess(user, acl, projectIdValue, requiredRole)) {
			throw new ForbiddenError();
		}
		return next();
	};
}

/**
 * Only a signed-in browser session: the portal. A bearer token — a personal
 * access token, an OAuth token (MCP) or an agent run token — is refused, however
 * much role its user has. Bearer sessions are built with an empty `token`
 * (lib/bearerAuth.ts); a cookie session always carries one.
 */
export function requirePortalSession() {
	return async (ctx: HonoContext, next: Next) => {
		if (!ctx.get("session")?.token) {
			throw new ForbiddenError("This action is only available from the Fluxify portal");
		}
		return next();
	};
}
