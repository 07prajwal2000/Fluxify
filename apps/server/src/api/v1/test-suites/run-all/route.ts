import { describeRoute, resolver, validator } from "hono-openapi";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { requestQuerySchema, responseSchema } from "./dto";
import { errorSchema } from "../../../../errors/customError";
import handleRequest from "./service";
import { validationErrorSchema } from "../../../../errors/validationError";
import { HonoServer } from "../../../../types";
import { requireTestSuiteAccess } from "../middleware";
import { z } from "zod";

export default function (app: HonoServer) {
	app.post(
		"/run-all",
		describeRoute({
			description: "Runs all test suites for a route.",
			operationId: "run-all-test-suites",
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
				409: {
					description: "Error",
					content: { "application/json": { schema: resolver(errorSchema) } },
				},
			},
		}),
		requireTestSuiteAccess("creator", (ctx) => ({ routeId: ctx.req.param("routeId") })),
		validator("param", z.object({ routeId: z.string().uuid() }), zodErrorCallbackParser),
		async (ctx) => {
			const { routeId } = ctx.req.valid("param");
			const result = await handleRequest(routeId);
			return ctx.json(result, result.success ? 200 : 400);
		},
	);
}
