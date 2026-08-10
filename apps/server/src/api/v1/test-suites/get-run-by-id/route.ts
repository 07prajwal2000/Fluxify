import { describeRoute, resolver, validator } from "hono-openapi";
import { requireProjectAccess } from "../../../auth/middleware";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { HonoServer } from "../../../../types";
import { requestParamSchema, responseSchema } from "./dto";
import handleRequest from "./service";

export default function (app: HonoServer) {
	app.get(
		"/:runId",
		describeRoute({
			description:
				"Gets one test run with the state of every suite it covers. Poll this while the run is queued or running.",
			operationId: "get-test-run",
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
					description: "Run not found",
					content: { "application/json": { schema: resolver(errorSchema) } },
				},
			},
		}),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestParamSchema, zodErrorCallbackParser),
		async (ctx) => {
			const { projectId, routeId, runId } = ctx.req.valid("param");
			return ctx.json(await handleRequest(projectId, routeId, runId));
		},
	);
}
