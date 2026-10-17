import { describeRoute, resolver } from "hono-openapi";
import { errorSchema } from "../../../../../errors/customError";
import type { HonoServer } from "../../../../../types";
import { requireSystemAdmin } from "../../../../auth/middleware";
import { responseSchema } from "./dto";
import handleRequest from "./service";

const json = (schema: Parameters<typeof resolver>[0]) => ({
	content: { "application/json": { schema: resolver(schema) } },
});

export default function (app: HonoServer) {
	app.get(
		"/filters",
		describeRoute({
			description:
				"What the audit log filters can be set to: the resource types and actions that have events, and the projects that have events (deleted ones flagged). Enterprise only.",
			operationId: "list-audit-log-filters",
			tags: ["Audit Logs"],
			responses: {
				200: { description: "Successful", ...json(responseSchema) },
				401: { description: "Unauthorized", ...json(errorSchema) },
				403: {
					description: "Not a system admin, or the license does not include audit logs",
					...json(errorSchema),
				},
			},
		}),
		requireSystemAdmin,
		async (c) => c.json(await handleRequest()),
	);
}
