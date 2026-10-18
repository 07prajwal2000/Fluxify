import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestBodySchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description:
		"Turns a selection of blocks (by key) on a route, workflow, custom block or sandbox canvas into a new custom block. The selection needs one entry block, at most one edge into it and at most one edge out of its single last block; otherwise it is refused with how to tidy it. With replace, the selection on the source canvas is swapped for one instance of the new block.",
	operationId: "extract-custom-block",
	tags: ["Custom Blocks"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		400: {
			description: "Empty or untidy selection, or a missing name",
			content: { "application/json": { schema: resolver(validationErrorSchema) } },
		},
		404: {
			description: "Source canvas not found",
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
		"/extract",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "body" }),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (ctx) => {
			const user = ctx.get("user") as { id: string };
			return ctx.json(await handleRequest(ctx.req.valid("json"), user.id));
		},
	);
}
