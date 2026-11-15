import { generateID } from "@fluxify/lib";
import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../errors/customError";
import { ForbiddenError } from "../../../errors/forbidError";
import { validationErrorSchema } from "../../../errors/validationError";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import { parseEnvelope } from "../../../modules/transfer/envelope";
import { transferHandlers } from "../../../modules/transfer/registry";
import type { HonoServer } from "../../../types";
import { requireProjectAccess } from "../../auth/middleware";
import {
	exportParamSchema,
	exportQuerySchema,
	importBodySchema,
	importCheckResultSchema,
	importResultSchema,
	resourceParamSchema,
} from "./dto";

const common = {
	400: {
		description: "Invalid data, or a file of another resource type",
		content: { "application/json": { schema: resolver(validationErrorSchema) } },
	},
	403: {
		description: "Forbidden",
		content: { "application/json": { schema: resolver(errorSchema) } },
	},
};

const describe = (
	operationId: string,
	description: string,
	ok: DescribeRouteOptions["responses"] = {},
): DescribeRouteOptions => ({
	operationId,
	description,
	tags: ["Transfer"],
	responses: { ...ok, ...common },
});

const json = (schema: Parameters<typeof resolver>[0], description = "Successful") => ({
	200: { description, content: { "application/json": { schema: resolver(schema) } } },
});

export default {
	name: "transfer",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/transfer");

		router.get(
			"/:resourceType/:id/export",
			describeRoute(
				describe(
					"export-resource",
					"Exports a route or workflow as a portable bundle. Unless includeTests=false, its test suites travel with it.",
					{
						...json(importBodySchema.shape.bundle),
						404: {
							description: "No record found",
							content: { "application/json": { schema: resolver(errorSchema) } },
						},
					},
				),
			),
			validator("param", exportParamSchema, zodErrorCallbackParser),
			validator("query", exportQuerySchema, zodErrorCallbackParser),
			async (ctx) => {
				const { resourceType, id } = ctx.req.valid("param");
				const { includeTests } = ctx.req.valid("query");
				const handler = transferHandlers[resourceType];
				const projectId = await handler.projectOf(id);
				const acl = ctx.get("acl") || [];
				if (!acl.some((a) => a.projectId === projectId || a.projectId === "*")) {
					throw new ForbiddenError();
				}
				return ctx.json(await handler.build(id, includeTests));
			},
		);

		router.post(
			"/:resourceType/import/check",
			describeRoute(
				describe(
					"check-resource-import",
					"Says whether a bundle about to be imported would clash with a resource of the project by name or path. Changes nothing.",
					json(importCheckResultSchema),
				),
			),
			requireProjectAccess("creator", { key: "projectId", source: "body" }),
			validator("param", resourceParamSchema, zodErrorCallbackParser),
			validator("json", importBodySchema, zodErrorCallbackParser),
			async (ctx) => {
				const { resourceType } = ctx.req.valid("param");
				const { projectId, bundle } = ctx.req.valid("json");
				const handler = transferHandlers[resourceType];
				const parsed = parseEnvelope(bundle, handler.spec);
				return ctx.json({ taken: await handler.conflicts(projectId, parsed) });
			},
		);

		router.post(
			"/:resourceType/import",
			describeRoute(
				describe(
					"import-resource",
					"Creates a route or workflow, its canvas and its test suites from an exported bundle, off in production. Middlewares, custom blocks and integrations are matched by name; what has no match is dropped and listed in warnings.",
					{
						...json(importResultSchema),
						409: {
							description: "The name or path is taken",
							content: { "application/json": { schema: resolver(errorSchema) } },
						},
					},
				),
			),
			requireProjectAccess("creator", { key: "projectId", source: "body" }),
			validator("param", resourceParamSchema, zodErrorCallbackParser),
			validator("json", importBodySchema, zodErrorCallbackParser),
			async (ctx) => {
				const { resourceType } = ctx.req.valid("param");
				const { projectId, bundle } = ctx.req.valid("json");
				const handler = transferHandlers[resourceType];
				const parsed = parseEnvelope(bundle, handler.spec);
				const actor = { userId: ctx.get("user")?.id ?? generateID(), acl: ctx.get("acl") || [] };
				return ctx.json(await handler.import(actor, projectId, parsed));
			},
		);
	},
};
