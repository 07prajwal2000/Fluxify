import { Context } from "hono";
import { MAX_REQUEST_BODY_BYTES } from "../../lib/env";
import { bodyReader } from "./requestBody";
import type { RequestEnvelope } from "./types";

/** Convert an HTTP request into the transport-neutral route envelope. */
export async function envelopeFromHttp(
	ctx: Context,
): Promise<RequestEnvelope> {
	const reader = bodyReader(ctx.req, MAX_REQUEST_BODY_BYTES);
	const envelope: RequestEnvelope = {
		trigger: {
			kind: "route",
			source: "http",
			reply: ctx.req.header("x-fluxify-reply") === "async" ? "async" : "sync",
			id: ctx.req.header("x-fluxify-id"),
		},
		payload: {
			method: ctx.req.method,
			path: ctx.req.path,
			headers: ctx.req.header(),
			query: ctx.req.query(),
			body: null,
			bodyReader: reader,
		},
	};
	if (reader && envelope.trigger.reply === "async") await reader.materialize();
	return envelope;
}
