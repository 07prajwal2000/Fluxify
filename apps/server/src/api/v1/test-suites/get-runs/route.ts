import { describeRoute, resolver, validator } from "hono-openapi";
import { requireProjectAccess } from "../../../auth/middleware";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { HonoServer } from "../../../../types";
import { requestParamSchema, requestQuerySchema, responseSchema } from "./dto";
import handleRequest from "./service";

export default function (app: HonoServer) {
	app.get(
		"/",
		describeRoute({
			description: "Lists test runs for a route, newest first.",
			operationId: "get-test-runs",
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
		validator("query", requestQuerySchema, zodErrorCallbackParser),
		async (ctx) => {
			const { projectId, routeId } = ctx.req.valid("param");
			const query = ctx.req.valid("query");
			return ctx.json(await handleRequest(projectId, routeId, query));
		},
	);
}
