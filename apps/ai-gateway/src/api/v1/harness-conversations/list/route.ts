import { zValidator } from "@hono/zod-validator";
import { queryParamsSchema, routeParamsSchema } from "./dto";
import handleRequest from "./service";
import { zodErrorCallbackParser, type User } from "@fluxify/server";
import type { Hono } from "hono";
import { verifyProjectAccess } from "../middleware";

export default function (app: Hono) {
	app.get(
		"/",
		zValidator("param", routeParamsSchema, zodErrorCallbackParser),
		zValidator("query", queryParamsSchema, zodErrorCallbackParser),
		verifyProjectAccess("viewer"),
		async (c: any) => {
			const user = c.get("user") as User;
			const param = c.req.valid("param");
			const query = c.req.valid("query");

			const result = await handleRequest(
				user.id,
				query.page,
				query.perPage,
				query.needUserQuery,
				{
					projectId: param.projectId,
					archived: query.archived,
					pinned: query.pinned,
					search: query.search,
				},
			);
			return c.json(result);
		},
	);
}
