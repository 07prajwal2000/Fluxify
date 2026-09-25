import { describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { targetFromParams, targetParamSchema } from "../../../../modules/testRunner/target";
import type { HonoServer } from "../../../../types";
import { requireTestSuiteAccess, targetFromPath } from "../middleware";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";

export default function (app: HonoServer) {
	app.post(
		"/",
		describeRoute({
			description: "Creates a new test suite.",
			operationId: "create-test-suite",
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
		requireTestSuiteAccess("creator", targetFromPath),
		validator("param", targetParamSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (ctx) => {
			const target = targetFromParams(ctx.req.valid("param"));
			const result = await handleRequest(ctx.req.valid("json"), target);
			return ctx.json(result);
		},
	);
}
