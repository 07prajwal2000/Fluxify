import { describeRoute, resolver, validator } from "hono-openapi";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { targetFromParams } from "../../../../modules/testRunner/target";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestParamSchema, requestQuerySchema, responseSchema } from "./dto";
import handleRequest from "./service";

export default function (app: HonoServer) {
	app.get(
		"/",
		describeRoute({
			description:
				"Lists recorded runs for a route or workflow, newest first. Headers only, no spans.",
			operationId: "get-recorded-runs",
			tags: ["Recordings"],
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
		// recordings hold unredacted payloads: creator even to read
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestParamSchema, zodErrorCallbackParser),
		validator("query", requestQuerySchema, zodErrorCallbackParser),
		async (ctx) => {
			const { projectId, ...target } = ctx.req.valid("param");
			const query = ctx.req.valid("query");
			return ctx.json(await handleRequest(projectId, targetFromParams(target), query));
		},
	);
}
