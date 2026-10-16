import { describeRoute, resolver, validator } from "hono-openapi";
import type z from "zod";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../types";
import { requireProjectAccess } from "../../auth/middleware";
import {
	bodySchema,
	getResponseSchema,
	idParamSchema,
	idResponseSchema,
	listResponseSchema,
	previewBodySchema,
	previewResponseSchema,
	projectParamSchema,
} from "./dto";
import * as service from "./service";

/** OpenAPI description for one endpoint: a summary and its 200 body */
function doc(operationId: string, description: string, schema: z.ZodType) {
	return describeRoute({
		description,
		operationId,
		tags: ["Knowledge Sources"],
		responses: {
			200: {
				description: "Successful",
				content: { "application/json": { schema: resolver(schema) } },
			},
		},
	});
}

const viewer = requireProjectAccess("viewer", { key: "projectId", source: "param" });
const creator = requireProjectAccess("creator", { key: "projectId", source: "param" });
const project = validator("param", projectParamSchema, zodErrorCallbackParser);
const id = validator("param", idParamSchema, zodErrorCallbackParser);
const body = validator("json", bodySchema, zodErrorCallbackParser);

/**
 * A project's custom knowledge base (#800): Markdown, URL and llms.txt sources
 * the AI agent searches next to the Fluxify docs. URL sources are fetched (GET)
 * when saved or refetched; header values come from app config, never stored here.
 */
export default {
	name: "knowledge-sources",
	registerHandler(app: HonoServer) {
		const router = app.basePath("/:projectId/knowledge-sources");

		router.get(
			"/",
			doc("get-knowledge-sources", "Lists a project's knowledge sources", listResponseSchema),
			viewer,
			project,
			async (c) => c.json(await service.list(c.req.valid("param").projectId)),
		);
		router.post(
			"/llms-txt/preview",
			doc(
				"preview-llms-txt",
				"Fetches an llms.txt and lists the pages it links to",
				previewResponseSchema,
			),
			creator,
			project,
			validator("json", previewBodySchema, zodErrorCallbackParser),
			async (c) =>
				c.json(await service.previewLlms(c.req.valid("param").projectId, c.req.valid("json"))),
		);
		router.get(
			"/:id",
			doc("get-knowledge-source", "Returns a knowledge source with its pages", getResponseSchema),
			viewer,
			id,
			async (c) => {
				const p = c.req.valid("param");
				return c.json(await service.get(p.projectId, p.id));
			},
		);
		router.post(
			"/",
			doc("create-knowledge-source", "Creates a knowledge source and fetches it", idResponseSchema),
			creator,
			project,
			body,
			async (c) =>
				c.json(await service.create(c.req.valid("param").projectId, c.req.valid("json"))),
		);
		router.put(
			"/:id",
			doc(
				"update-knowledge-source",
				"Replaces a knowledge source; fetches it again when its URL, headers or pages changed",
				idResponseSchema,
			),
			creator,
			id,
			body,
			async (c) => {
				const p = c.req.valid("param");
				return c.json(await service.update(p.projectId, p.id, c.req.valid("json")));
			},
		);
		router.post(
			"/:id/refetch",
			doc("refetch-knowledge-source", "Fetches a knowledge source again", getResponseSchema),
			creator,
			id,
			async (c) => {
				const p = c.req.valid("param");
				return c.json(await service.refetch(p.projectId, p.id));
			},
		);
		router.delete(
			"/:id",
			doc("delete-knowledge-source", "Deletes a knowledge source", idResponseSchema),
			creator,
			id,
			async (c) => {
				const p = c.req.valid("param");
				return c.json(await service.remove(p.projectId, p.id));
			},
		);
	},
};
