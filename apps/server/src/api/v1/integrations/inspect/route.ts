import { type DescribeRouteOptions, describeRoute, validator } from "hono-openapi";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import {
	inspectBodySchema,
	inspectQuerySchema,
	kvQuerySchema,
	requestRouteSchema,
	schemaQuerySchema,
} from "./dto";
import { getKvValue, getSchemaDetails, inspectIntegration } from "./service";

const schemaDocs: DescribeRouteOptions = {
	description:
		"Read a database integration's schema. Without `tables`: table or collection names. With `tables` (comma separated): columns, keys and indexes; for Mongo, field types inferred from sampled documents. Never returns row data.",
	operationId: "get-integration-schema-details",
	tags: ["Integrations"],
};

const kvDocs: DescribeRouteOptions = {
	description:
		"Read one key from a KV integration: the value (capped at 10,000 characters) and its TTL where the store reports one. Read only. Connects with development credentials unless `env=production`.",
	operationId: "get-integration-kv-value",
	tags: ["Integrations"],
};

const inspectDocs: DescribeRouteOptions = {
	description:
		"Run the integration's inspect: the body is the request its variant defines (a database: `{ tables?: string[] }`, a KV store: `{ key }`), and the answer is what the variant returns. Read only. Plugin integrations are inspected on a worker of the chosen environment. Connects with development credentials unless `env=production`.",
	operationId: "inspect-integration",
	tags: ["Integrations"],
};

export default function (app: HonoServer) {
	app.post(
		"/:integrationId/inspect",
		describeRoute(inspectDocs),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("query", inspectQuerySchema, zodErrorCallbackParser),
		validator("json", inspectBodySchema, zodErrorCallbackParser),
		async (c) =>
			c.json(
				(await inspectIntegration(
					c.req.valid("param"),
					c.req.valid("json"),
					c.req.valid("query").env,
				)) as object,
			),
	);
	app.get(
		"/:integrationId/schema",
		describeRoute(schemaDocs),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("query", schemaQuerySchema, zodErrorCallbackParser),
		async (c) => c.json(await getSchemaDetails(c.req.valid("param"), c.req.valid("query").tables)),
	);
	app.get(
		"/:integrationId/kv",
		describeRoute(kvDocs),
		requireProjectAccess("creator", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("query", kvQuerySchema, zodErrorCallbackParser),
		async (c) => {
			const { key, env } = c.req.valid("query");
			return c.json(await getKvValue(c.req.valid("param"), key, env));
		},
	);
}
