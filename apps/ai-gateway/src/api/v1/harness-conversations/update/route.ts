import { zValidator } from "@hono/zod-validator";
import { routeParamsSchema, requestBodySchema } from "./dto";
import handleRequest from "./service";
import { zodErrorCallbackParser, type User } from "@fluxify/server";
import type { Hono } from "hono";
import { verifyHarnessConversationOwner, verifyProjectAccess } from "../middleware";

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
