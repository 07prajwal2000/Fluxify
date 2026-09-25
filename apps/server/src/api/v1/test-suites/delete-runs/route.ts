import { describeRoute, resolver, validator } from "hono-openapi";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { targetFromParams } from "../../../../modules/testRunner/target";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestParamSchema, responseSchema } from "./dto";
import handleRequest from "./service";

export default function (app: HonoServer) {
	app.delete(
		"/",
		describeRoute({
			description: "Clears every test run recorded for a route or workflow.",
			operationId: "delete-test-runs",
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
			},
		}),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestParamSchema, zodErrorCallbackParser),
		async (ctx) => {
			const { projectId, ...target } = ctx.req.valid("param");
			return ctx.json(await handleRequest(projectId, targetFromParams(target)));
		},
	);
}
