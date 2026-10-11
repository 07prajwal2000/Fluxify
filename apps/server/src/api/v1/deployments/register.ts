import { describeRoute, resolver, validator } from "hono-openapi";
import { z } from "zod";
import type { CanvasVersionKind } from "../../../db/schema";
import { errorSchema } from "../../../errors/customError";
import { validationErrorSchema } from "../../../errors/validationError";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import {
	deployBodySchema,
	deploymentListSchema,
	deploymentParamSchema,
	deploymentSchema,
} from "../../../modules/deployments/dto";
import {
	deployVersion,
	getTargetDeployment,
	listTargetDeployments,
} from "../../../modules/deployments/service";
import type { HonoServer } from "../../../types";
import { requireLoggedIn } from "../../auth/middleware";

const idParamSchema = z.object({ id: z.uuidv7() });

const response = (schema: Parameters<typeof resolver>[0], description = "Successful") => ({
	200: { description, content: { "application/json": { schema: resolver(schema) } } },
});

const failures = (noun: string) => ({
	400: {
		description: "Invalid data",
		content: { "application/json": { schema: resolver(validationErrorSchema) } },
	},
	403: {
		description: "Forbidden",
		content: { "application/json": { schema: resolver(errorSchema) } },
	},
	404: {
		description: `${noun}, version or deployment not found`,
		content: { "application/json": { schema: resolver(errorSchema) } },
	},
});

/**
 * Promote and rollback for routes and workflows (#739), registered under
 * `/routes` and `/workflows`. Viewers read the log; creators deploy.
 */
export function registerDeploymentRoutes(router: HonoServer, kind: CanvasVersionKind) {
	const noun = kind === "route" ? "Route" : "Workflow";
	const tags = [kind === "route" ? "Routes" : "Workflows"];
	const userId = (ctx: { get: (key: "user") => unknown }) =>
		(ctx.get("user") as { id?: string } | undefined)?.id;

	router.post(
		"/:id/deployments",
		describeRoute({
			operationId: `deploy-${kind}-version`,
			description: `Puts a version of the ${kind} live in production. A version older than the one live is a rollback. The checks run first; one that fails is answered with status "failed" and its reasons in "gates". 409 when that version is already live.`,
			tags,
			responses: {
				...response(deploymentSchema, "The deployment, live or failed"),
				...failures(noun),
				409: {
					description: "That version is already live, or a deployment is in progress",
					content: { "application/json": { schema: resolver(errorSchema) } },
				},
			},
		}),
		requireLoggedIn(),
		validator("param", idParamSchema, zodErrorCallbackParser),
		validator("json", deployBodySchema, zodErrorCallbackParser),
		async (ctx) =>
			ctx.json(
				await deployVersion(
					kind,
					ctx.req.valid("param").id,
					ctx.req.valid("json"),
					userId(ctx),
					ctx.get("acl") || [],
				),
			),
	);

	router.get(
		"/:id/deployments",
		describeRoute({
			operationId: `list-${kind}-deployments`,
			description: `What went to production for this ${kind}, newest first`,
			tags,
			responses: { ...response(deploymentListSchema), ...failures(noun) },
		}),
		validator("param", idParamSchema, zodErrorCallbackParser),
		async (ctx) =>
			ctx.json(await listTargetDeployments(kind, ctx.req.valid("param").id, ctx.get("acl") || [])),
	);

	router.get(
		"/:id/deployments/:deploymentId",
		describeRoute({
			operationId: `get-${kind}-deployment`,
			description:
				"One deployment: its status and what each check said. Poll this while it is pending.",
			tags,
			responses: { ...response(deploymentSchema), ...failures(noun) },
		}),
		validator("param", deploymentParamSchema, zodErrorCallbackParser),
		async (ctx) => {
			const { id, deploymentId } = ctx.req.valid("param");
			return ctx.json(await getTargetDeployment(kind, id, deploymentId, ctx.get("acl") || []));
		},
	);
}
