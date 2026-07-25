import { zValidator } from "@hono/zod-validator";
import { queryParamsSchema } from "./dto";
import handleRequest from "./service";
import { zodErrorCallbackParser, type User } from "@fluxify/server";
import type { Hono } from "hono";

export default function (app: Hono) {
	app.get(
		"/",
		zValidator("query", queryParamsSchema, zodErrorCallbackParser),
		async (c: any) => {
			const user = c.get("user") as User;
			const query = c.req.valid("query");

			const result = await handleRequest(
				user.id,
				query.page,
				query.perPage,
				query.needUserQuery,
			);
			return c.json(result);
		},
	);
}
