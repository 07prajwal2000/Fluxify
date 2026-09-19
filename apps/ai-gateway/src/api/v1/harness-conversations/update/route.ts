import { type User, zodErrorCallbackParser } from "@fluxify/server";
import { zValidator } from "@hono/zod-validator";
import type { Hono } from "hono";
import { verifyHarnessConversationOwner, verifyProjectAccess } from "../middleware";
import { requestBodySchema, routeParamsSchema } from "./dto";
import handleRequest from "./service";

export default function (app: Hono) {
	app.patch(
		"/:conversationId",
		zValidator("param", routeParamsSchema, zodErrorCallbackParser),
		zValidator("json", requestBodySchema, zodErrorCallbackParser),
		verifyProjectAccess("creator"),
		verifyHarnessConversationOwner,
		async (c: any) => {
			const user = c.get("user") as User;
			const param = c.req.valid("param");
			const body = c.req.valid("json");

			const result = await handleRequest(param.conversationId, body.title, user.id);
			return c.json(result);
		},
	);
}
