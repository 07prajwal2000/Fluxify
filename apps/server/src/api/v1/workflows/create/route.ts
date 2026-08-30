import { describeRoute, DescribeRouteOptions, resolver, validator } from "hono-openapi";
import { generateID } from "@fluxify/lib";
import { HonoServer } from "../../../../types";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Creates a workflow and its starting canvas",
	operationId: "create-workflow",
	tags: ["Workflows"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		400: {
			description: "Invalid data",
			content: { "application/json": { schema: resolver(validationErrorSchema) } },
		},
		403: {
			description: "Forbidden",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
		404: {
			description: "Project not found",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
		409: {
			description: "Duplicate name",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.post(
		"/",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "body" }),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (ctx) => {
			const userId = (ctx.get("user") as { id?: string } | undefined)?.id ?? generateID();
			const result = await handleRequest(
				userId,
				ctx.req.valid("json"),
				ctx.get("acl") || [],
			);
			return ctx.json(result);
		},
	);
}
