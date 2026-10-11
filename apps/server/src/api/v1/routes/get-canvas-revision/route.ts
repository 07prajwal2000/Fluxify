import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { canvasRevisionSchema } from "../../../../modules/canvas/types";
import type { HonoServer } from "../../../../types";
import { requestRouteSchema } from "../get-canvas-items/dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "The route canvas's save counter, for spotting changes made elsewhere",
	operationId: "get-canvas-revision",
	tags: ["Routes"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(canvasRevisionSchema) } },
		},
		400: {
			description: "Invalid ID",
			content: { "application/json": { schema: resolver(validationErrorSchema) } },
		},
		404: {
			description: "No matching route found",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/:id/canvas-revision",
		describeRoute(openapiRouteOptions),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		async (c) => {
			const { id } = c.req.valid("param");
			return c.json(await handleRequest(id, c.get("acl") || []));
		},
	);
}
