import { zValidator } from "@hono/zod-validator";
import { queryParamsSchema, routeParamsSchema } from "./dto";
import handleRequest from "./service";
import { zodErrorCallbackParser } from "@fluxify/server";
import type { Hono } from "hono";
import { verifyHarnessConversationOwner, verifyProjectAccess } from "../middleware";

export default function (app: Hono) {
	app.get(
		"/:conversationId/messages",
		zValidator("param", routeParamsSchema, zodErrorCallbackParser),
		zValidator("query", queryParamsSchema, zodErrorCallbackParser),
		verifyProjectAccess("viewer"),
		// 403 unless the caller owns the conversation (404 if it isn't theirs to see).
		verifyHarnessConversationOwner,
		async (c: any) => {
			const param = c.req.valid("param");
			const query = c.req.valid("query");

			const result = await handleRequest(param.conversationId, query.cursor);
			return c.json(result);
		},
	);
}
