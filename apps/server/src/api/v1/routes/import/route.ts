import { generateID } from "@fluxify/lib";
import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { importRouteBundle } from "../../../../modules/routeTransfer/import";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestBodySchema, responseSchema } from "./dto";

const openapiRouteOptions: DescribeRouteOptions = {
	description:
		"Creates a route, its canvas and its test suites from an exported bundle. Middlewares, custom blocks and integrations are matched by name; what has no match is dropped and listed in warnings.",
	operationId: "import-route",
	tags: ["Routes"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		400: {
			description: "Not a route export, or invalid",
			content: { "application/json": { schema: resolver(validationErrorSchema) } },
		},
		409: {
			description: "The route's name or path is taken",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
	},
};

export default function (app: HonoServer) {
	app.post(
		"/import",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "body" }),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (ctx) => {
			const { projectId, bundle } = ctx.req.valid("json");
			// same placeholder the create endpoint uses for the author
			return ctx.json(await importRouteBundle(generateID(), projectId, bundle));
		},
	);
}
