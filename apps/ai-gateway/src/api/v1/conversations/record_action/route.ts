import { zValidator } from "@hono/zod-validator";
import { recordActionParamSchema, recordActionBodySchema } from "./dto";
import { recordActionService } from "./service";
import { zodErrorCallbackParser } from "@fluxify/server";
import { Hono } from "hono";

export default function (app: Hono) {
	app.post(
		"/:conversationId/record-action",
		zValidator("param", recordActionParamSchema, zodErrorCallbackParser),
		zValidator("json", recordActionBodySchema, zodErrorCallbackParser),
		async (c: any) => {
			const param = c.req.valid("param");
			const body = c.req.valid("json");

			const result = await recordActionService(
				param.conversationId,
				body.chatId,
				body.action,
				body.reviews,
				body.rejectReason
			);

			return c.json(result);
		},
	);
}
