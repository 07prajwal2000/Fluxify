import { zValidator } from "@hono/zod-validator";
import { routeParamsSchema, requestBodySchema } from "./dto";
import handleRequest from "./service";
import { zodErrorCallbackParser } from "@fluxify/server";
import type { Hono } from "hono";
import { verifyHarnessConversationOwner, verifyProjectAccess } from "../middleware";

export default function (app: Hono) {
	app.post(
		"/:conversationId/action",
		zValidator("param", routeParamsSchema, zodErrorCallbackParser),
		zValidator("json", requestBodySchema, zodErrorCallbackParser),
		verifyProjectAccess("creator"),
		verifyHarnessConversationOwner,
		async (c: any) => {
			const param = c.req.valid("param");
			const body = c.req.valid("json");
			const conversation = c.get("conversation") as {
				userId: string | null;
				archived: boolean;
			};

			const result = await handleRequest(param.conversationId, body.action, conversation);
			return c.json(result);
		},
	);
}
