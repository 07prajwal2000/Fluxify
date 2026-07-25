import { zValidator } from "@hono/zod-validator";
import { requestBodySchema } from "./dto";
import handleRequest from "./service";
import { zodErrorCallbackParser, type User } from "@fluxify/server";
import type { Hono } from "hono";

export default function (app: Hono) {
	app.post(
		"/message",
		zValidator("json", requestBodySchema, zodErrorCallbackParser),
		async (c: any) => {
			const user = c.get("user") as User & { isSystemAdmin: boolean };
			const body = c.req.valid("json");

			const result = await handleRequest(user.id, body, user.isSystemAdmin);
			return c.json(result);
		},
	);
}
