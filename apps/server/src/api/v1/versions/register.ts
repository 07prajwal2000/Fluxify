import { describeRoute, resolver, validator } from "hono-openapi";
import { z } from "zod";
import type { CanvasVersionKind } from "../../../db/schema";
import { errorSchema } from "../../../errors/customError";
import { validationErrorSchema } from "../../../errors/validationError";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import {
	checkoutBodySchema,
	checkoutResultSchema,
	commitBodySchema,
	versionDetailSchema,
	versionListSchema,
	versionParamSchema,
	versionSchema,
} from "../../../modules/versions/dto";
import {
	checkoutVersion,
	commitVersion,
	getTargetVersion,
	listTargetVersions,
} from "../../../modules/versions/service";
import { NOUN } from "../../../modules/versions/targets";
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
		description: `${noun} or version not found`,
		content: { "application/json": { schema: resolver(errorSchema) } },
	},
});

const TAGS = {
	route: "Routes",
	workflow: "Workflows",
	custom_block: "Custom Blocks",
	middleware: "Middlewares",
} as const;

/**
 * Version history for routes, workflows, custom blocks and middlewares (#738,
 * #740). Registered under `/routes`, `/workflows`, `/custom-blocks` and
 * `/middlewares`, so all four read the same and one place decides who may do
 * what: viewers read, creators commit and check out.
 */
export function registerVersionRoutes(router: HonoServer, kind: CanvasVersionKind) {
	const noun = NOUN[kind][0]!.toUpperCase() + NOUN[kind].slice(1);
	const tags = [TAGS[kind]];
	const userId = (ctx: { get: (key: "user") => unknown }) =>
		(ctx.get("user") as { id?: string } | undefined)?.id;

	router.post(
		"/:id/versions",
		describeRoute({
			operationId: `commit-${kind}-version`,
			description: `Commits the ${kind}'s working copy as its next version. Never deploys. 409 when nothing changed since the last version.`,
			tags,
			responses: {
				...response(versionSchema, "The new version"),
				...failures(noun),
				409: {
					description: "Nothing to commit",
					content: { "application/json": { schema: resolver(errorSchema) } },
				},
			},
		}),
		requireLoggedIn(),
		validator("param", idParamSchema, zodErrorCallbackParser),
		validator("json", commitBodySchema, zodErrorCallbackParser),
		async (ctx) =>
			ctx.json(
				await commitVersion(
					kind,
					ctx.req.valid("param").id,
					ctx.req.valid("json"),
					userId(ctx),
					ctx.get("acl") || [],
				),
			),
	);

	router.get(
		"/:id/versions",
		describeRoute({
			operationId: `list-${kind}-versions`,
			description: `The ${kind}'s versions, newest first, and whether the working copy has uncommitted changes`,
			tags,
			responses: { ...response(versionListSchema), ...failures(noun) },
		}),
		validator("param", idParamSchema, zodErrorCallbackParser),
		async (ctx) =>
			ctx.json(await listTargetVersions(kind, ctx.req.valid("param").id, ctx.get("acl") || [])),
	);

	router.get(
		"/:id/versions/:versionId",
		describeRoute({
			operationId: `get-${kind}-version`,
			description: `One version of the ${kind}, with its blocks, edges and settings`,
			tags,
			responses: { ...response(versionDetailSchema), ...failures(noun) },
		}),
		validator("param", versionParamSchema, zodErrorCallbackParser),
		async (ctx) => {
			const { id, versionId } = ctx.req.valid("param");
			return ctx.json(await getTargetVersion(kind, id, versionId, ctx.get("acl") || []));
		},
	);

	router.post(
		"/:id/versions/:versionId/checkout",
		describeRoute({
			operationId: `checkout-${kind}-version`,
			description: `Makes a version the ${kind}'s working copy. Uncommitted work is saved as a new version first, so nothing is lost.`,
			tags,
			responses: {
				...response(checkoutResultSchema),
				...failures(noun),
				409: {
					description: "The version's path and method are taken by another route",
					content: { "application/json": { schema: resolver(errorSchema) } },
				},
			},
		}),
		requireLoggedIn(),
		validator("param", versionParamSchema, zodErrorCallbackParser),
		validator("json", checkoutBodySchema, zodErrorCallbackParser),
		async (ctx) => {
			const { id, versionId } = ctx.req.valid("param");
			return ctx.json(
				await checkoutVersion(
					kind,
					id,
					versionId,
					ctx.req.valid("json"),
					userId(ctx),
					ctx.get("acl") || [],
				),
			);
		},
	);
}
