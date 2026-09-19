import { describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireTestSuiteAccess } from "../middleware";
import { testSuiteCoreSchema } from "../schema";
import { requestRouteSchema } from "./dto";
import handleRequest from "./service";

export default function (app: HonoServer) {
	app.get(
		"/:id",
		describeRoute({
			description: "Gets a test suite.",
			operationId: "get-test-suite",
			tags: ["Test Suites"],
			responses: {
				200: {
					description: "Successful",
					content: {
						"application/json": { schema: resolver(testSuiteCoreSchema) },
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
		requireTestSuiteAccess("viewer"),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		async (ctx) => {
			const { id } = ctx.req.valid("param");
			const result = await handleRequest(id);
			return ctx.json(result);
		},
	);
}
