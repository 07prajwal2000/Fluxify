import { type User, zodErrorCallbackParser } from "@fluxify/server";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { verifyProjectAccess } from "../middleware";
import { requestBodySchema, routeParamsSchema } from "./dto";
import handleRequest from "./service";

export default function (app: Hono) {
	app.post(
		"/message",
		zValidator("param", routeParamsSchema, zodErrorCallbackParser),
		zValidator("json", requestBodySchema, zodErrorCallbackParser),
		verifyProjectAccess("creator"),
		async (c: any) => {
			const user = c.get("user") as User & { isSystemAdmin: boolean };
			const param = c.req.valid("param");
			const body = c.req.valid("json");

			const result = await handleRequest(user.id, param.projectId, body, user.isSystemAdmin);
			return c.json(result);
		},
	);
}
