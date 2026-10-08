import { describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { paramSchema, responseSchema } from "./dto";
import handleRequest from "./service";

export default function (app: HonoServer) {
	app.get(
		"/project/:projectId",
		describeRoute({
			description: "Gets all test suites of a project, across its routes and workflows.",
			operationId: "list-project-test-suites",
			tags: ["Test Suites"],
			responses: {
				200: {
					description: "Successful",
					content: { "application/json": { schema: resolver(responseSchema) } },
				},
				400: {
					description: "Invalid data",
					content: { "application/json": { schema: resolver(validationErrorSchema) } },
				},
				409: {
					description: "Error",
					content: { "application/json": { schema: resolver(errorSchema) } },
				},
			},
		}),
		requireProjectAccess("viewer", { key: "projectId", source: "param" }),
		validator("param", paramSchema, zodErrorCallbackParser),
		async (ctx) => ctx.json(await handleRequest(ctx.req.valid("param").projectId)),
	);
}
