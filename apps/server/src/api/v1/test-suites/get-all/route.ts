import { describeRoute, resolver, validator } from "hono-openapi";
import { z } from "zod";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireTestSuiteAccess } from "../middleware";
import { testSuiteCoreSchema } from "../schema";
import { requestQuerySchema } from "./dto";
import handleRequest from "./service";

export default function (app: HonoServer) {
	app.get(
		"/",
		describeRoute({
			description: "Gets all test suites for a route.",
			operationId: "get-all-test-suites",
			tags: ["Test Suites"],
			responses: {
				200: {
					description: "Successful",
					content: {
						"application/json": {
							schema: resolver(z.array(testSuiteCoreSchema)),
						},
					},
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
		requireTestSuiteAccess("viewer", (ctx) => ({ routeId: ctx.req.param("routeId") })),
		validator("param", z.object({ routeId: z.string().uuid() }), zodErrorCallbackParser),
		async (ctx) => {
			const { routeId } = ctx.req.valid("param");
			const result = await handleRequest(routeId);
			return ctx.json(result);
		},
	);
}
