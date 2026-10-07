import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { canvasVersionSchema } from "../../../../modules/canvas/types";
import type { HonoServer } from "../../../../types";
import { requestParamSchema } from "../get-canvas-items/dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "The custom block canvas's save counter, for spotting changes made elsewhere",
	operationId: "get-canvas-version",
	tags: ["Custom Blocks"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(canvasVersionSchema) } },
		},
		400: {
			description: "Invalid ID",
			content: { "application/json": { schema: resolver(validationErrorSchema) } },
		},
		404: {
			description: "No matching custom block found",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/:id/canvas-version",
		describeRoute(openapiRouteOptions),
		validator("param", requestParamSchema, zodErrorCallbackParser),
		async (c) => {
			const { id } = c.req.valid("param");
			return c.json(await handleRequest(id, c.get("user") as any, c.get("acl") || []));
		},
	);
}
