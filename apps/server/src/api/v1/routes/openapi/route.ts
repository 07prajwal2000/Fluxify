import { validator } from "hono-openapi";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { normalizeEnv, requestParamSchema, requestQuerySchema } from "./dto";
import { generateOpenApiSpec } from "./service";

export default function (app: HonoServer) {
	app.get(
		"/:projectId/openapi.json",
		validator("param", requestParamSchema, zodErrorCallbackParser),
		validator("query", requestQuerySchema, zodErrorCallbackParser),
		async (ctx: any) => {
			const param = ctx.req.valid("param");
			const query = ctx.req.valid("query");
			const env = normalizeEnv(query?.env);

			try {
				const spec = await generateOpenApiSpec(param, new URL(ctx.req.url).origin, env);
				ctx.header("Cache-Control", "no-cache, must-revalidate");
				return ctx.json(spec);
			} catch (error: any) {
				if (error.message === "Project not found") {
					return ctx.json({ error: error.message }, 404);
				}
				return ctx.json({ error: "Internal Server Error" }, 500);
			}
		},
	);
}
