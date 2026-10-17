import { type DescribeRouteOptions, describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../../errors/customError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import type { HonoServer } from "../../../../types";
import { requireProjectAccess } from "../../../auth/middleware";
import {
	callbackQuerySchema,
	callbackRouteSchema,
	connectResponseSchema,
	disconnectResponseSchema,
	requestBodySchema,
	requestRouteSchema,
} from "./dto";
import { callback, connect, disconnect } from "./service";

const errors = {
	400: {
		description: "Not an OAuth MCP server, or the sign in is invalid",
		content: { "application/json": { schema: resolver(errorSchema) } },
	},
	403: {
		description: "Only project admins can connect MCP servers",
		content: { "application/json": { schema: resolver(errorSchema) } },
	},
	404: {
		description: "Integration not found",
		content: { "application/json": { schema: resolver(errorSchema) } },
	},
};

const connectOptions: DescribeRouteOptions = {
	description:
		"Start connecting an MCP server with OAuth. Returns the address to sign in at. One shared account per integration.",
	operationId: "connect-mcp-oauth",
	tags: ["Integrations"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(connectResponseSchema) } },
		},
		...errors,
	},
};

const callbackOptions: DescribeRouteOptions = {
	description:
		"Where the MCP server sends the browser back after sign in. Saves the tokens, then redirects to the portal.",
	operationId: "mcp-oauth-callback",
	tags: ["Integrations"],
	responses: { 302: { description: "Back to the integration in the portal" }, ...errors },
};

const disconnectOptions: DescribeRouteOptions = {
	description: "Forget an environment's OAuth connection to an MCP server.",
	operationId: "disconnect-mcp-oauth",
	tags: ["Integrations"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(disconnectResponseSchema) } },
		},
		...errors,
	},
};

export default function (app: HonoServer) {
	app.post(
		"/:id/mcp-oauth/connect",
		describeRoute(connectOptions),
		requireProjectAccess("project_admin", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (c) => {
			const { projectId, id } = c.req.valid("param");
			const { env } = c.req.valid("json");
			return c.json(await connect(projectId, id, env, c.get("user")!.id));
		},
	);

	app.get(
		"/mcp-oauth/callback",
		describeRoute(callbackOptions),
		requireProjectAccess("project_admin", { key: "projectId", source: "param" }),
		validator("param", callbackRouteSchema, zodErrorCallbackParser),
		validator("query", callbackQuerySchema, zodErrorCallbackParser),
		async (c) => {
			const { projectId } = c.req.valid("param");
			return c.redirect(await callback(projectId, c.get("user")!.id, c.req.valid("query")));
		},
	);

	app.post(
		"/:id/mcp-oauth/disconnect",
		describeRoute(disconnectOptions),
		requireProjectAccess("project_admin", { key: "projectId", source: "param" }),
		validator("param", requestRouteSchema, zodErrorCallbackParser),
		validator("json", requestBodySchema, zodErrorCallbackParser),
		async (c) => {
			const { projectId, id } = c.req.valid("param");
			const { env } = c.req.valid("json");
			return c.json(await disconnect(projectId, id, env));
		},
	);
}
