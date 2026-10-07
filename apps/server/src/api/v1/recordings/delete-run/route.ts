import { describeRoute, resolver, validator } from "hono-openapi";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { targetFromParams } from "../../../../modules/testRunner/target";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import handleRequest from "../delete-runs/service";
import { requestParamSchema, responseSchema } from "./dto";

export default function (app: HonoServer) {
	app.delete(
		"/:runId",
		describeRoute({
			description:
				"Deletes one recorded run. `deleted` is 0 when the run is not in this project and target.",
			operationId: "delete-recorded-run",
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
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestParamSchema, zodErrorCallbackParser),
		async (ctx) => {
			const { projectId, runId, ...target } = ctx.req.valid("param");
			return ctx.json(await handleRequest(projectId, targetFromParams(target), runId));
		},
	);
}
