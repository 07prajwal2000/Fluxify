import {
	describeRoute,
	DescribeRouteOptions,
	resolver,
	validator,
} from "hono-openapi";
import { generateID } from "@fluxify/lib";
import { HonoServer } from "../../../types";
import { errorSchema } from "../../../errors/customError";
import { validationErrorSchema } from "../../../errors/validationError";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import { requireLoggedIn, requireProjectAccess } from "../../auth/middleware";
import {
	createdSchema,
	createGroupSchema,
	createSchema,
	groupListQuerySchema,
	groupListSchema,
	idParamSchema,
	listQuerySchema,
	listSchema,
	patchSchema,
	previewQuerySchema,
	previewSchema,
	triggerSchema,
} from "./dto";
import {
	createTrigger,
	createTriggerGroup,
	deleteTrigger,
	deleteTriggerGroup,
	getTrigger,
	listAllTriggers,
	listTriggerGroups,
	previewSchedule,
	updateTrigger,
} from "./service";

/** The response blocks every endpoint here shares, so each one names only its own. */
const common = {
	400: {
		description: "Invalid data",
		content: { "application/json": { schema: resolver(validationErrorSchema) } },
	},
	403: {
		description: "Forbidden",
		content: { "application/json": { schema: resolver(errorSchema) } },
	},
	404: {
		description: "Trigger not found",
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
	tags: ["Triggers"],
	responses: { ...ok, ...common },
});

const json = (schema: Parameters<typeof resolver>[0], description = "Successful") => ({
	200: { description, content: { "application/json": { schema: resolver(schema) } } },
});

const userId = (ctx: { get: (key: string) => unknown }) =>
	(ctx.get("user") as { id?: string } | undefined)?.id ?? generateID();

export default {
	name: "triggers",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/triggers");

		router.get(
			"/list",
			describeRoute(
				describe("get-triggers-list", "Lists triggers, newest edit first", json(listSchema)),
			),
			validator("query", listQuerySchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(await listAllTriggers(ctx.req.valid("query"), ctx.get("acl") || [])),
		);

		router.get(
			"/groups",
			describeRoute(
				describe("get-trigger-groups", "Lists a project's trigger groups", json(groupListSchema)),
			),
			validator("query", groupListQuerySchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(
					await listTriggerGroups(ctx.req.valid("query").projectId, ctx.get("acl") || []),
				),
		);

		router.post(
			"/groups",
			describeRoute(
				describe("create-trigger-group", "Creates a trigger group", json(createdSchema)),
			),
			requireProjectAccess("creator", { key: "projectId", source: "body" }),
			validator("json", createGroupSchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(
					await createTriggerGroup(userId(ctx), ctx.req.valid("json"), ctx.get("acl") || []),
				),
		);

		router.delete(
			"/groups/:id",
			describeRoute(
				describe("delete-trigger-group", "Deletes an empty trigger group", json(createdSchema)),
			),
			requireLoggedIn(),
			validator("param", idParamSchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(await deleteTriggerGroup(ctx.req.valid("param").id, ctx.get("acl") || [])),
		);

		router.get(
			"/schedule/preview",
			describeRoute(
				describe(
					"preview-schedule",
					"Explains a schedule and lists its next fires",
					json(previewSchema),
				),
			),
			requireLoggedIn(),
			validator("query", previewQuerySchema, zodErrorCallbackParser),
			(ctx) => ctx.json(previewSchedule(ctx.req.valid("query"))),
		);

		router.get(
			"/:id",
			describeRoute(describe("get-trigger", "Returns one trigger", json(triggerSchema))),
			validator("param", idParamSchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(await getTrigger(ctx.req.valid("param").id, ctx.get("acl") || [])),
		);

		router.post(
			"/",
			describeRoute(
				describe("create-trigger", "Creates a trigger for a workflow", {
					...json(createdSchema),
					409: {
						description: "Duplicate name",
						content: { "application/json": { schema: resolver(errorSchema) } },
					},
				}),
			),
			requireProjectAccess("creator", { key: "projectId", source: "body" }),
			validator("json", createSchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(
					await createTrigger(userId(ctx), ctx.req.valid("json"), ctx.get("acl") || []),
				),
		);

		router.patch(
			"/:id",
			describeRoute(describe("update-trigger", "Patches a trigger", json(triggerSchema))),
			requireLoggedIn(),
			validator("param", idParamSchema, zodErrorCallbackParser),
			validator("json", patchSchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(
					await updateTrigger(
						ctx.req.valid("param").id,
						ctx.req.valid("json"),
						ctx.get("acl") || [],
					),
				),
		);

		router.delete(
			"/:id",
			describeRoute(describe("delete-trigger", "Deletes a trigger", json(createdSchema))),
			requireLoggedIn(),
			validator("param", idParamSchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(await deleteTrigger(ctx.req.valid("param").id, ctx.get("acl") || [])),
		);
	},
};
