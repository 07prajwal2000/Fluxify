import { describeRoute, resolver, validator } from "hono-openapi";
import { z } from "zod";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { targetFromParams, targetParamSchema } from "../../../../modules/testRunner/target";
import type { HonoServer } from "../../../../types";
import { requireTestSuiteAccess, targetFromPath } from "../middleware";
import { testSuiteCoreSchema } from "../schema";
import { requestQuerySchema } from "./dto";
import handleRequest from "./service";

export default function (app: HonoServer) {
	app.get(
		"/",
		describeRoute({
			description: "Gets all test suites for a route or workflow.",
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
		requireTestSuiteAccess("viewer", targetFromPath),
		validator("param", targetParamSchema, zodErrorCallbackParser),
		async (ctx) => {
			const result = await handleRequest(targetFromParams(ctx.req.valid("param")));
			return ctx.json(result);
		},
	);
}
