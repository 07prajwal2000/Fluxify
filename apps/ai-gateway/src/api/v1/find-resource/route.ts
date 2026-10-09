import {
	type AuthACL,
	ForbiddenError,
	hasProjectAccess,
	type User,
	zodErrorCallbackParser,
} from "@fluxify/server";
import { zValidator } from "@hono/zod-validator";
import type { Hono, MiddlewareHandler } from "hono";
import { queryParamsSchema, routeParamsSchema } from "./dto";
import handleRequest from "./service";

/** The caller must hold the viewer role in the project named in the path. */
const verifyProjectAccess: MiddlewareHandler = async (c, next) => {
	const user = c.get("user") as (User & { isSystemAdmin: boolean }) | null;
	const projectId = c.req.param("projectId") as string;
	if (!user || !hasProjectAccess(user, c.get("acl") as AuthACL[], projectId, "viewer"))
		throw new ForbiddenError("You do not have access to this project");
	await next();
};

export default function (app: Hono) {
	app.get(
		"/:projectId/find-resource",
		zValidator("param", routeParamsSchema, zodErrorCallbackParser),
		zValidator("query", queryParamsSchema, zodErrorCallbackParser),
		verifyProjectAccess,
		async (c: any) => {
			const param = c.req.valid("param");
			const query = c.req.valid("query");

			return c.json(await handleRequest(param.projectId, query.q));
		},
	);
}
