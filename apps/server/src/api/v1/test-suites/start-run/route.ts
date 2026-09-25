import { describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { targetFromParams } from "../../../../modules/testRunner/target";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestBodySchema, requestParamSchema, responseSchema } from "./dto";
import handleRequest from "./service";

export default function (app: HonoServer) {
	app.post(
		"/",
		describeRoute({
			description:
				"Queues a test run for a route or workflow and returns its id immediately. Poll the run for results.",
			operationId: "start-test-run",
			tags: ["Test Suites"],
			responses: {
				202: {
					description: "Run accepted",
					content: { "application/json": { schema: resolver(responseSchema) } },
				},
				400: {
					description: "Invalid data",
					content: {
						"application/json": { schema: resolver(validationErrorSchema) },
					},
				},
				403: {
					description: "Forbidden",
					content: { "application/json": { schema: resolver(errorSchema) } },
				},
				404: {
					description: "Target or suites not found",
					content: { "application/json": { schema: resolver(errorSchema) } },
				},
			},
		}),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestParamSchema, zodErrorCallbackParser),
		async (ctx) => {
			const { projectId, ...target } = ctx.req.valid("param");
			// "run everything" is a bodyless POST, so a missing body is not an error
			const parsed = requestBodySchema.safeParse(await ctx.req.json().catch(() => ({})));
			if (!parsed.success) return zodErrorCallbackParser(parsed, ctx)!;
			const { suiteIds } = parsed.data;
			const result = await handleRequest({ projectId, target: targetFromParams(target), suiteIds });
			return ctx.json(result, 202);
		},
	);
}
