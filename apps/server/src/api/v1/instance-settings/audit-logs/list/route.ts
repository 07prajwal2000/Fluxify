import { describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../../errors/customError";
import { validationErrorSchema } from "../../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../../types";
import { requireSystemAdmin } from "../../../../auth/middleware";
import { requestQuerySchema, responseSchema } from "./dto";
import handleRequest from "./service";

const json = (schema: Parameters<typeof resolver>[0]) => ({
	content: { "application/json": { schema: resolver(schema) } },
});

export default function (app: HonoServer) {
	app.get(
		"/",
		describeRoute({
			description:
				"Audit log events, newest first, with filters. Page through with nextCursor. Events of deleted projects are included. Enterprise only; reading is not itself logged.",
			operationId: "list-audit-logs",
			tags: ["Audit Logs"],
			responses: {
				200: { description: "Successful", ...json(responseSchema) },
				400: { description: "Invalid filter or cursor", ...json(validationErrorSchema) },
				401: { description: "Unauthorized", ...json(errorSchema) },
				403: {
					description: "Not a system admin, or the license does not include audit logs",
					...json(errorSchema),
				},
			},
		}),
		requireSystemAdmin,
		validator("query", requestQuerySchema, zodErrorCallbackParser),
		async (c) => c.json(await handleRequest(c.req.valid("query"))),
	);
}
