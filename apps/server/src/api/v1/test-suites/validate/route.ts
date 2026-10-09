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
		"/:id/validate",
		describeRoute({
			description:
				"Checks a suite's checks against the response of its last run, or a sample you send, without running anything. Reports paths the response does not have and values an operator cannot use.",
			operationId: "validate-test-suite",
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
					description: "Suite not found",
					content: { "application/json": { schema: resolver(errorSchema) } },
				},
			},
		}),
		requireTestSuiteAccess("creator"),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (ctx) => ctx.json(await handleRequest(ctx.get("testSuite"), ctx.req.valid("json"))),
	);
}
