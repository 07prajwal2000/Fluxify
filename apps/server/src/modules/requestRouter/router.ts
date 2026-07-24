import { HttpRouteParser } from "@fluxify/lib";
import { logger } from "@fluxify/common";
import { Hono } from "hono";
import { dispatch, envelopeFromHttp } from "./service";

export async function mapRouter(app: Hono<any>, parser: HttpRouteParser) {
	app.all("*", async (c) => {
		const env = await envelopeFromHttp(c);

		// fire-and-forget / background jobs & crons: ack immediately, run detached.
		// ponytail: block engine still caps execution at RESPONSE_TIMEOUT (4s);
		// lift that cap when real long-running jobs land, keyed off trigger.reply.
		if (env.trigger.reply === "async") {
			queueMicrotask(() =>
				dispatch(env, parser).catch((e) =>
					logger.error(`async dispatch failed: ${e?.toString()}`),
				),
			);
			return c.json({ accepted: true, id: env.trigger.id }, 202);
		}

		try {
			const response = await dispatch(env, parser, c);
			c.status(response.status);
			return c.json(response.data);
		} catch (error) {
			return c.json(
				{ message: error?.toString() || "Internal server error" },
				500,
			);
		}
	});
}
