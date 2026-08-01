import {
	describeRoute,
	DescribeRouteOptions,
	resolver,
	validator,
} from "hono-openapi";
import { requestRouteSchema, responseSchema } from "./dto";
import handleRequest from "./service";
import { errorSchema } from "../../../../errors/customError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";

const openapiRouteOptions: DescribeRouteOptions = {
	description:
		"Get the metadata of an integration. Databases return their tables and columns.",
	operationId: "get-integration-metadata",
	tags: ["Integrations"],
	responses: {
		200: {
			description: "Successful",
			content: {
				"application/json": {
					schema: resolver(responseSchema),
				},
			},
		},
		400: {
			description: "Metadata unavailable for this integration",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
		404: {
			description: "Integration not found",
			content: {
				"application/json": {
					schema: resolver(errorSchema),
				},
			},
		},
	},
};

export default function (app: HonoServer) {
	app.get(
		"/:integrationId/metadata",
		describeRoute(openapiRouteOptions),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		async (c) => {
			const params = c.req.valid("param");
			return c.json(await handleRequest(params));
		},
	);
}
