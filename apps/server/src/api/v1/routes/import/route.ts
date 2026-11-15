import { generateID } from "@fluxify/lib";
import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { parseEnvelope } from "../../../../modules/transfer/envelope";
import { routeHandler } from "../../../../modules/transfer/handlers/route";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import { requestBodySchema, responseSchema } from "./dto";

const openapiRouteOptions: DescribeRouteOptions = {
	description:
		"Deprecated, use POST /v1/transfer/route/import. Creates a route, its canvas and its test suites from an exported bundle. Middlewares, custom blocks and integrations are matched by name; what has no match is dropped and listed in warnings.",
	operationId: "import-route",
	tags: ["Routes"],
	deprecated: true,
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
			const parsed = parseEnvelope(bundle, routeHandler.spec);
			return ctx.json(
				await routeHandler.import({ userId: generateID(), acl: [] }, projectId, parsed),
			);
		},
	);
}
