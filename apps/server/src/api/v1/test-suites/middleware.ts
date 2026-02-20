import { Next } from "hono";
import {
  AccessControlRole,
  AuthACL,
  routesEntity,
  testSuitesEntity,
} from "../../../db/schema";
import { db } from "../../../db";
import { eq } from "drizzle-orm";
import { ForbiddenError } from "../../../errors/forbidError";
import { NotFoundError } from "../../../errors/notFoundError";
import { canAccessProject } from "../../../lib/acl";
import { User } from "better-auth";
import { HonoContext } from "../../../types";

export function requireTestSuiteAccess(requiredRole: AccessControlRole) {
  return async function (ctx: HonoContext, next: Next) {
    // 1. Resolve projectId
    const suiteId = ctx.req.param("id");
    let routeId = ctx.req.query("route_id");
    let projectId: string | null = null;

    if (!routeId && ctx.req.method === "POST" && !suiteId) {
      // Handle body for create endpoint
      const bodyTemplate = await ctx.req.raw
        .clone()
        .json()
        .catch(() => ({}));
      routeId = bodyTemplate?.route_id;
    }

    if (suiteId) {
      const suite = await db
        .select()
        .from(testSuitesEntity)
        .leftJoin(routesEntity, eq(routesEntity.id, testSuitesEntity.routeId))
        .where(eq(testSuitesEntity.id, suiteId))
        .then((res) => res[0]);

      if (!suite || !suite.test_suites)
        throw new NotFoundError("Test suite not found");
      if (!suite.routes) throw new NotFoundError("Associated route not found");
      projectId = suite.routes.projectId as string;
      ctx.set("testSuite", suite.test_suites);
      ctx.set("routeId", suite.routes.id);
    } else if (routeId) {
      const [route] = await db
        .select()
        .from(routesEntity)
        .where(eq(routesEntity.id, routeId));

      if (!route) throw new NotFoundError("Route not found");
      projectId = route.projectId as string;
      ctx.set("routeId", routeId);
    }

    if (!projectId) {
      throw new NotFoundError("Could not resolve project ID");
    }

    ctx.set("projectId", projectId);

    // 2. Validate Access
    const user = ctx.get("user") as User & { isSystemAdmin: boolean };
    if (user?.isSystemAdmin) {
      return next();
    }
    const acl = ctx.get("acl") as AuthACL[];
    if (!acl || !canAccessProject(acl, projectId, requiredRole)) {
      throw new ForbiddenError();
    }

    return next();
  };
}
