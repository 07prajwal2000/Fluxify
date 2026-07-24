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

export function requireTestSuiteAccess(
  requiredRole: AccessControlRole,
  getParams: (ctx: HonoContext) => { suiteId?: string; routeId?: string } | Promise<{ suiteId?: string; routeId?: string }> = (ctx) => ({ suiteId: ctx.req.param("id") })
) {
  return async function (ctx: HonoContext, next: Next) {
    // 1. Resolve projectId
    const { suiteId, routeId } = await getParams(ctx);
    let projectId: string | null = null;

    if (!suiteId && !routeId) {
      throw new NotFoundError("Test suite ID or Route ID not provided");
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
