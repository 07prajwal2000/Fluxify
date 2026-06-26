import { Hono } from "hono";
import {
	describeRoute,
	type DescribeRouteOptions,
	resolver,
	validator,
} from "hono-openapi";
import { responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
	description: "Description",
	operationId: "identifier",
	tags: ["TAG"],
	responses: {
		200: {
			description: "Successful",
			content: {
				"application/json": {
					schema: resolver(responseSchema),
				},
			},
		},
	},
};

export default function (app: Hono) {
	app.get(
		"/",
		describeRoute(openapiRouteOptions),
		// validator("query", SCHEMA),
		async (c) => {},
	);
}
