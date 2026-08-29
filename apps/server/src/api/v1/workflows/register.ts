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
import { canvasChangesSchema, canvasItemsSchema } from "../../../modules/canvas/types";
import { requestBodyValidator } from "../../../modules/canvas/blockDataValidator";
import { getCanvas, saveCanvas } from "../../../modules/canvas/service";
import { canAccess } from "../../../lib/acl";
import {
	createdSchema,
	createSchema,
	idParamSchema,
	listQuerySchema,
	listSchema,
	patchSchema,
	runAcceptedSchema,
	runSchema,
	workflowSchema,
} from "./dto";
import {
	createWorkflow,
	deleteWorkflow,
	getWorkflow,
	listAllWorkflows,
	mustAccess,
	updateWorkflow,
} from "./service";
import runWorkflow from "./run";

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
		description: "Workflow not found",
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
	tags: ["Workflows"],
	responses: { ...ok, ...common },
});

const json = (schema: Parameters<typeof resolver>[0], description = "Successful") => ({
	200: { description, content: { "application/json": { schema: resolver(schema) } } },
});

export default {
	name: "workflows",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/workflows");

		router.get(
			"/list",
			describeRoute(
				describe("get-workflows-list", "Lists workflows, newest edit first", json(listSchema)),
			),
			validator("query", listQuerySchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(await listAllWorkflows(ctx.req.valid("query"), ctx.get("acl") || [])),
		);

		router.get(
			"/:id",
			describeRoute(describe("get-workflow", "Returns one workflow", json(workflowSchema))),
			validator("param", idParamSchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(await getWorkflow(ctx.req.valid("param").id, ctx.get("acl") || [])),
		);

		router.post(
			"/",
			describeRoute(
				describe("create-workflow", "Creates a workflow and its starting canvas", {
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
					await createWorkflow(
						(ctx.get("user") as { id?: string } | undefined)?.id ?? generateID(),
						ctx.req.valid("json"),
						ctx.get("acl") || [],
					),
				),
		);

		router.patch(
			"/:id",
			describeRoute(describe("update-workflow", "Patches a workflow", json(workflowSchema))),
			requireLoggedIn(),
			validator("param", idParamSchema, zodErrorCallbackParser),
			validator("json", patchSchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(
					await updateWorkflow(
						ctx.req.valid("param").id,
						ctx.req.valid("json"),
						ctx.get("acl") || [],
					),
				),
		);

		router.delete(
			"/:id",
			describeRoute(describe("delete-workflow", "Deletes a workflow", json(createdSchema))),
			requireLoggedIn(),
			validator("param", idParamSchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(await deleteWorkflow(ctx.req.valid("param").id, ctx.get("acl") || [])),
		);

		router.get(
			"/:id/canvas-items",
			describeRoute(
				describe("get-workflow-canvas-items", "The workflow's blocks and edges", json(canvasItemsSchema)),
			),
			validator("param", idParamSchema, zodErrorCallbackParser),
			async (ctx) => {
				const { id } = ctx.req.valid("param");
				// a viewer may read a canvas, so access is settled here rather than by
				// the canvas service's project scoping
				await mustAccess(id, ctx.get("acl") || [], "viewer");
				return ctx.json(await getCanvas({ type: "workflow", id }, ["*"]));
			},
		);

		router.put(
			"/:id/save-canvas",
			describeRoute(
				describe("save-workflow-canvas-state", "Applies canvas changes to a workflow", {
					204: { description: "No content returned after successful operation" },
				}),
			),
			validator("param", idParamSchema, zodErrorCallbackParser),
			validator("json", canvasChangesSchema, zodErrorCallbackParser),
			requestBodyValidator,
			async (ctx) => {
				const acl = ctx.get("acl") || [];
				await saveCanvas(
					{ type: "workflow", id: ctx.req.valid("param").id },
					ctx.req.valid("json"),
					acl.filter((a) => canAccess(a.role, "creator")).map((a) => a.projectId),
				);
				return ctx.body(null, 204);
			},
		);

		router.post(
			"/:id/run",
			describeRoute(
				describe("run-workflow", "Queues one run of a workflow", json(runAcceptedSchema, "Queued")),
			),
			requireLoggedIn(),
			validator("param", idParamSchema, zodErrorCallbackParser),
			validator("json", runSchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(
					await runWorkflow(
						ctx.req.valid("param").id,
						ctx.req.valid("json"),
						(ctx.get("user") as { id?: string } | undefined)?.id ?? "",
						ctx.get("acl") || [],
					),
				),
		);
	},
};
