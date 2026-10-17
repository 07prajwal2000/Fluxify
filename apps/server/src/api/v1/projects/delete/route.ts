import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireSystemAdmin } from "../../../auth/middleware";
import { requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Delete the project and everything it owns. System admins only.",
	operationId: "delete-project",
	tags: ["Projects"],
	responses: {
		200: {
			description: "Deleted",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		403: {
			description: "Not a system admin",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
		404: {
			description: "No project found with id",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.delete(
		"/:id",
		describeRoute(openapiRouteOptions),
		requireSystemAdmin,
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		async (c) => {
			const { id } = c.req.valid("param");
			return c.json(await handleRequest(id));
		},
	);
}
