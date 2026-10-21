import type { User } from "better-auth";
import type { Context, Next } from "hono";
import type z from "zod";
import type { AuthACL } from "../../../../db/schema";
import { ForbiddenError } from "../../../../errors/forbidError";
import { ValidationError } from "../../../../errors/validationError";
import { mapZodErrorToFieldErrors } from "../../../../lib/errors";
import { hasProjectAccess } from "../../../auth/common";
import { getIntegrationById } from "../test-existing-connection/repository";
import { variantConfigSchema } from "../variants/service";
import type { requestBodySchema } from "./dto";

export async function requestBodyValidator(ctx: Context, next: Next) {
	const jsonData = await ctx.req.json();
	const data = integrationConfigValidator(jsonData);
	ctx.set("config", data);
	// development's config is the same shape, so it passes the same schema
	if (jsonData.devConfig != null) {
		ctx.set("devConfig", integrationConfigValidator({ ...jsonData, config: jsonData.devConfig }));
	}
	return next();
}

function integrationConfigValidator(jsonData: z.infer<typeof requestBodySchema>) {
	const config = jsonData.config;
	const result = variantConfigSchema(jsonData.group, jsonData.variant).safeParse(config);
	if (!result.success) {
		const errors = mapZodErrorToFieldErrors(result.error);
		throw new ValidationError(errors);
	}
	return result.data;
}

/**
 * An `mcp` integration points at an outside server, so only a project admin
 * writes one; every other group stays with the route's creator check.
 */
export async function requireAdminForMcp(ctx: Context, next: Next) {
	const projectId = ctx.req.param("projectId")!;
	const group =
		ctx.req.method === "POST"
			? (await ctx.req.json()).group
			: (await getIntegrationById(projectId, ctx.req.param("id")!))?.group;
	if (group === "mcp") {
		const user = ctx.get("user") as User & { isSystemAdmin: boolean };
		const acl = ctx.get("acl") as AuthACL[];
		if (!hasProjectAccess(user, acl, projectId, "project_admin")) {
			throw new ForbiddenError("Only project admins can manage MCP servers");
		}
	}
	return next();
}
