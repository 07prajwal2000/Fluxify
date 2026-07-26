import { zValidator } from "@hono/zod-validator";
import { routeParamsSchema } from "./dto";
import handleRequest from "./service";
import { zodErrorCallbackParser, type User } from "@fluxify/server";
import type { Hono } from "hono";
import { verifyHarnessConversationOwner, verifyProjectAccess } from "../middleware";

export default function (app: Hono) {
	app.delete(
		"/:conversationId",
		zValidator("param", routeParamsSchema, zodErrorCallbackParser),
		verifyProjectAccess("creator"),
		verifyHarnessConversationOwner,
		async (c: any) => {
			const user = c.get("user") as User;
			const param = c.req.valid("param");

			const result = await handleRequest(param.conversationId, user.id);
			return c.json(result);
		},
	);
}
