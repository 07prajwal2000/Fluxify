import { Next } from "hono";
import { AuthACL } from "../../db/schema";
import { UnauthorizedError } from "../../errors/unauthorizedError";
import { HonoContext } from "../../types";
import { AccessControlRole } from "../../db/schema";
import { canAccess, canAccessProject } from "../../lib/acl";
import { User } from "better-auth";
import { ForbiddenError } from "../../errors/forbidError";

export async function requireSystemAdmin(ctx: HonoContext, next: Next) {
  const user = ctx.get("user") as User & { isSystemAdmin: boolean };
  const systemAccessKey = ctx.req.header("SYSTEM_ACCESS_KEY");
  if (
    user?.isSystemAdmin ||
    systemAccessKey === process.env.SYSTEM_ACCESS_KEY
  ) {
    return next();
  }
  throw new ForbiddenError("Only system admins can access");
}

export function requireRoleAccess(requiredRole: AccessControlRole) {
  return async function (ctx: HonoContext, next: Next) {
    const user = ctx.get("user") as User & { isSystemAdmin: boolean };
    if (user?.isSystemAdmin) {
      return next();
    }
    const acl = ctx.get("acl") as AuthACL[];
    if (!acl || !canAccess(acl, requiredRole)) {
      throw new ForbiddenError();
    }
    return next();
  };
}

export function requireProjectAccess(
  requiredRole: AccessControlRole,
  projectId:
    | string
    | { source: "param" | "query" | "header" | "body"; key: string }
) {
  return async function (ctx: HonoContext, next: Next) {
    let projectIdValue: string;
    if (typeof projectId === "string") {
      projectIdValue = projectId;
    } else {
      switch (projectId.source) {
        case "param":
          projectIdValue = ctx.req.param(projectId.key);
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
    if (user?.isSystemAdmin) {
      return next();
    }
    const acl = ctx.get("acl") as AuthACL[];
    if (!acl || !canAccessProject(acl, projectIdValue, requiredRole)) {
      throw new ForbiddenError();
    }
    return next();
  };
}
