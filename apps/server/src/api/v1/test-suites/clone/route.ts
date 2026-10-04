import { describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireTestSuiteAccess } from "../middleware";
import { requestBodySchema, requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";

export default function (app: HonoServer) {
	app.post(
		"/:id/clone",
		describeRoute({
			description: "Copies a test suite to a route or workflow of the same project.",
			operationId: "clone-test-suite",
			tags: ["Test Suites"],
			responses: {
				200: {
					description: "Successful",
					content: { "application/json": { schema: resolver(responseSchema) } },
				},
				400: {
					description: "Invalid data",
					content: {
						"application/json": { schema: resolver(validationErrorSchema) },
					},
				},
				404: {
					description: "Suite or target not found",
					content: { "application/json": { schema: resolver(errorSchema) } },
				},
			},
		}),
		requireTestSuiteAccess("creator"),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (ctx) => {
			const { kind, targetId } = ctx.req.valid("json");
			const result = await handleRequest(ctx.get("testSuite"), ctx.get("projectId")!, {
				type: kind,
				id: targetId,
			});
			return ctx.json(result);
		},
	);
}
