import { describeRoute, resolver, validator } from "hono-openapi";
import type z from "zod";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import type { HonoContext } from "../../../types";
import { requireProjectAccess } from "../../auth/middleware";
import { projectQuerySchema } from "./dto";

export function doc(operationId: string, description: string, schema: z.ZodType) {
	return describeRoute({
		description,
		operationId,
		tags: ["Plugins"],
		responses: {
			200: {
				description: "Successful",
				content: { "application/json": { schema: resolver(schema) } },
			},
		},
	});
}

export const caller = (ctx: HonoContext) => ({
	user: ctx.get("user") as any,
	acl: ctx.get("acl") || [],
});
export const project = validator("query", projectQuerySchema, zodErrorCallbackParser);
export const viewer = requireProjectAccess("viewer", { key: "projectId", source: "query" });
/** the services check creator themselves too: other callers reach them without HTTP */
export const creator = requireProjectAccess("creator", { key: "projectId", source: "query" });
