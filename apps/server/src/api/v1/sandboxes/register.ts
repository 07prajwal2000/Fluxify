import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../errors/customError";
import { validationErrorSchema } from "../../../errors/validationError";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import { requestBodyValidator } from "../../../modules/canvas/blockDataValidator";
import { getCanvas, readCanvasVersion, saveCanvas } from "../../../modules/canvas/service";
import {
	canvasChangesSchema,
	canvasItemsSchema,
	canvasVersionSchema,
	saveCanvasQuerySchema,
	saveCanvasResultSchema,
} from "../../../modules/canvas/types";
import type { HonoContext, HonoServer } from "../../../types";
import { requireLoggedIn, requireProjectAccess } from "../../auth/middleware";
import { responseSchema as runDetailSchema } from "../recordings/get-run-by-id/dto";
import getRecordedRun from "../recordings/get-run-by-id/service";
import {
	requestQuerySchema as runsQuerySchema,
	responseSchema as runsSchema,
} from "../recordings/get-runs/dto";
import getRecordedRuns from "../recordings/get-runs/service";
import { runAcceptedSchema, runSchema } from "../workflows/dto";
import {
	createdSchema,
	createSchema,
	idParamSchema,
	listSchema,
	patchSchema,
	projectParamSchema,
	runParamSchema,
	sandboxSchema,
} from "./dto";
import {
	createSandbox,
	deleteSandbox,
	getSandbox,
	listMySandboxes,
	mustOwn,
	runSandbox,
	updateSandbox,
} from "./service";

const common = {
	400: {
		description: "Invalid data",
		content: { "application/json": { schema: resolver(validationErrorSchema) } },
	},
	403: {
		description: "Not a creator in this project",
		content: { "application/json": { schema: resolver(errorSchema) } },
	},
	404: {
		description: "No such sandbox of yours",
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
	tags: ["Sandboxes"],
	responses: { ...ok, ...common },
});

const json = (schema: Parameters<typeof resolver>[0], description = "Successful") => ({
	200: { description, content: { "application/json": { schema: resolver(schema) } } },
});

/** the signed-in user; the owner check refuses an empty one */
const userOf = (ctx: HonoContext) => (ctx.get("user") as { id?: string } | undefined)?.id ?? "";

/**
 * Sandboxes (#735): `/v1/projects/:projectId/sandboxes`. A creator's own
 * throwaway canvases; nobody else's are visible, whatever their role.
 */
export default {
	name: "sandboxes",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/projects/:projectId/sandboxes");
		const creator = requireProjectAccess("creator", { key: "projectId", source: "param" });

		router.get(
			"/",
			describeRoute(describe("list-sandboxes", "Your sandboxes in this project", json(listSchema))),
			creator,
			validator("param", projectParamSchema, zodErrorCallbackParser),
			async (ctx) => ctx.json(await listMySandboxes(ctx.req.valid("param").projectId, userOf(ctx))),
		);

		router.post(
			"/",
			describeRoute(
				describe(
					"create-sandbox",
					"Creates a sandbox and its starting canvas",
					json(createdSchema),
				),
			),
			requireLoggedIn(),
			creator,
			validator("param", projectParamSchema, zodErrorCallbackParser),
			validator("json", createSchema, zodErrorCallbackParser),
			async (ctx) =>
				ctx.json(
					await createSandbox(ctx.req.valid("param").projectId, userOf(ctx), ctx.req.valid("json")),
				),
		);

		router.get(
			"/:id",
			describeRoute(describe("get-sandbox", "Returns one of your sandboxes", json(sandboxSchema))),
			creator,
			validator("param", idParamSchema, zodErrorCallbackParser),
			async (ctx) => {
				const { projectId, id } = ctx.req.valid("param");
				return ctx.json(await getSandbox(projectId, id, userOf(ctx)));
			},
		);

		router.patch(
			"/:id",
			describeRoute(
				describe(
					"update-sandbox",
					"Renames a sandbox or changes its settings",
					json(sandboxSchema),
				),
			),
			creator,
			validator("param", idParamSchema, zodErrorCallbackParser),
			validator("json", patchSchema, zodErrorCallbackParser),
			async (ctx) => {
				const { projectId, id } = ctx.req.valid("param");
				return ctx.json(await updateSandbox(projectId, id, userOf(ctx), ctx.req.valid("json")));
			},
		);

		router.delete(
			"/:id",
			describeRoute(describe("delete-sandbox", "Deletes a sandbox", json(createdSchema))),
			creator,
			validator("param", idParamSchema, zodErrorCallbackParser),
			async (ctx) => {
				const { projectId, id } = ctx.req.valid("param");
				return ctx.json(await deleteSandbox(projectId, id, userOf(ctx)));
			},
		);

		router.get(
			"/:id/canvas-items",
			describeRoute(
				describe(
					"get-sandbox-canvas-items",
					"The sandbox's blocks and edges",
					json(canvasItemsSchema),
				),
			),
			creator,
			validator("param", idParamSchema, zodErrorCallbackParser),
			async (ctx) => {
				const { projectId, id } = ctx.req.valid("param");
				await mustOwn(projectId, id, userOf(ctx));
				return ctx.json(await getCanvas({ type: "sandbox", id }, [projectId]));
			},
		);

		router.get(
			"/:id/canvas-version",
			describeRoute(
				describe(
					"get-sandbox-canvas-version",
					"The sandbox canvas's save counter, for spotting changes made elsewhere",
					json(canvasVersionSchema),
				),
			),
			creator,
			validator("param", idParamSchema, zodErrorCallbackParser),
			async (ctx) => {
				const { projectId, id } = ctx.req.valid("param");
				await mustOwn(projectId, id, userOf(ctx));
				return ctx.json(await readCanvasVersion({ type: "sandbox", id }, [projectId]));
			},
		);

		router.put(
			"/:id/save-canvas",
			describeRoute(
				describe(
					"save-sandbox-canvas-state",
					"Applies canvas changes to a sandbox; it is recompiled for development",
					json(saveCanvasResultSchema, "Saved (or checked, with dryRun)"),
				),
			),
			creator,
			validator("param", idParamSchema, zodErrorCallbackParser),
			validator("json", canvasChangesSchema, zodErrorCallbackParser),
			validator("query", saveCanvasQuerySchema, zodErrorCallbackParser),
			requestBodyValidator,
			async (ctx) => {
				const { projectId, id } = ctx.req.valid("param");
				await mustOwn(projectId, id, userOf(ctx));
				return ctx.json(
					await saveCanvas(
						{ type: "sandbox", id },
						ctx.req.valid("json"),
						[projectId],
						undefined,
						false,
						ctx.req.valid("query"),
					),
				);
			},
		);

		router.post(
			"/:id/run",
			describeRoute(
				describe(
					"run-sandbox",
					"Queues one run of the sandbox as a workflow, on a development worker",
					{
						...json(runAcceptedSchema, "Queued"),
						409: {
							description: "No development worker is running",
							content: { "application/json": { schema: resolver(errorSchema) } },
						},
					},
				),
			),
			creator,
			validator("param", idParamSchema, zodErrorCallbackParser),
			validator("json", runSchema, zodErrorCallbackParser),
			async (ctx) => {
				const { projectId, id } = ctx.req.valid("param");
				return ctx.json(await runSandbox(projectId, id, userOf(ctx), ctx.req.valid("json")));
			},
		);

		router.get(
			"/:id/runs",
			describeRoute(
				describe("get-sandbox-runs", "The sandbox's recorded runs, newest first", json(runsSchema)),
			),
			creator,
			validator("param", idParamSchema, zodErrorCallbackParser),
			validator("query", runsQuerySchema, zodErrorCallbackParser),
			async (ctx) => {
				const { projectId, id } = ctx.req.valid("param");
				await mustOwn(projectId, id, userOf(ctx));
				const target = { type: "sandbox" as const, id };
				return ctx.json(await getRecordedRuns(projectId, target, ctx.req.valid("query")));
			},
		);

		router.get(
			"/:id/runs/:runId",
			describeRoute(
				describe("get-sandbox-run", "One recorded run with its spans", json(runDetailSchema)),
			),
			creator,
			validator("param", runParamSchema, zodErrorCallbackParser),
			async (ctx) => {
				const { projectId, id, runId } = ctx.req.valid("param");
				await mustOwn(projectId, id, userOf(ctx));
				return ctx.json(await getRecordedRun(projectId, { type: "sandbox", id }, runId));
			},
		);
	},
};
