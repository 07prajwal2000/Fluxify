import { describeRoute, resolver, validator } from "hono-openapi";
import z from "zod";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { listSystemLogs } from "../../../../lib/systemLogs";
import { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";

export const systemLogsQuerySchema = z.object({
	resourceType: z.string().optional(),
	resourceId: z.string().optional(),
	type: z.string().optional(),
	level: z.enum(["info", "warn", "error"]).optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const systemLogSchema = z.object({
	id: z.number(),
	projectId: z.string().nullable(),
	resourceType: z.string(),
	resourceId: z.string(),
	type: z.string(),
	level: z.enum(["info", "warn", "error"]),
	message: z.string(),
	detail: z.record(z.string(), z.unknown()).nullable(),
	updatedAt: z.string(),
});

export const systemLogsResponseSchema = z.object({ items: z.array(systemLogSchema) });

export default function (app: HonoServer) {
	app.get(
		"/:id/system-logs",
		describeRoute({
			description: "Platform logs for a project (compile results, …), one per resource, most recently written first",
			operationId: "get-project-system-logs",
			tags: ["Projects"],
			responses: {
				200: {
					description: "Successful",
					content: { "application/json": { schema: resolver(systemLogsResponseSchema) } },
				},
				400: {
					description: "Invalid query",
					content: { "application/json": { schema: resolver(validationErrorSchema) } },
				},
				403: {
					description: "Forbidden",
					content: { "application/json": { schema: resolver(errorSchema) } },
				},
			},
		}),
		requireProjectAccess("viewer", { source: "param", key: "id" }),
		validator("query", systemLogsQuerySchema, zodErrorCallbackParser),
		async (c) => {
			const items = await listSystemLogs({
				...c.req.valid("query"),
				projectId: c.req.param("id")!,
			});
			return c.json({ items });
		},
	);
}
