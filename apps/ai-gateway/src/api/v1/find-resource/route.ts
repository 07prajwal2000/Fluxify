import { zValidator } from "@hono/zod-validator";
import { zodErrorCallbackParser } from "@fluxify/server";
import type { Hono } from "hono";
import { verifyProjectAccess } from "../harness-conversations/middleware";
import { queryParamsSchema, routeParamsSchema } from "./dto";
import handleRequest from "./service";

export default function (app: Hono) {
	app.get(
		"/:projectId/find-resource",
		zValidator("param", routeParamsSchema, zodErrorCallbackParser),
		zValidator("query", queryParamsSchema, zodErrorCallbackParser),
		verifyProjectAccess("viewer"),
		async (c: any) => {
			const param = c.req.valid("param");
			const query = c.req.valid("query");

			return c.json(await handleRequest(param.projectId, query.q));
		},
	);
}
