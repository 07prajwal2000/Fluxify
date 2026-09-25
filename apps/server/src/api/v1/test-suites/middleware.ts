import type { User } from "better-auth";
import { eq } from "drizzle-orm";
import type { Next } from "hono";
import { db } from "../../../db";
import { type AccessControlRole, type AuthACL, testSuitesEntity } from "../../../db/schema";
import { ForbiddenError } from "../../../errors/forbidError";
import { NotFoundError } from "../../../errors/notFoundError";
import { canAccessProject } from "../../../lib/acl";
import {
	type SuiteTarget,
	suiteTargetTypeSchema,
	targetOf,
	targetProject,
} from "../../../modules/testRunner/target";
import type { HonoContext } from "../../../types";

type AccessParams = { suiteId?: string; target?: SuiteTarget };

/** the route or workflow named by the `:kind/:targetId` path */
export const targetFromPath = (ctx: HonoContext): AccessParams => {
	const kind = suiteTargetTypeSchema.safeParse(ctx.req.param("kind"));
	const id = ctx.req.param("targetId");
	return kind.success && id ? { target: { type: kind.data, id } } : {};
};

export function requireTestSuiteAccess(
	requiredRole: AccessControlRole,
	getParams: (ctx: HonoContext) => AccessParams | Promise<AccessParams> = (ctx) => ({
		suiteId: ctx.req.param("id"),
	}),
) {
	return async (ctx: HonoContext, next: Next) => {
		// 1. Resolve the target, then its project
		let { suiteId, target } = await getParams(ctx);
		if (!suiteId && !target) {
			throw new NotFoundError("Test suite ID or target not provided");
		}

		if (suiteId) {
			const [suite] = await db
				.select()
				.from(testSuitesEntity)
				.where(eq(testSuitesEntity.id, suiteId));
			if (!suite) throw new NotFoundError("Test suite not found");
			ctx.set("testSuite", suite);
			target = targetOf(suite);
		}

		const projectId = await targetProject(target!);
		if (!projectId) throw new NotFoundError(`Associated ${target!.type} not found`);
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
