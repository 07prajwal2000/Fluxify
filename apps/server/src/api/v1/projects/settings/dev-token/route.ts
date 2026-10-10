import { type DescribeRouteOptions, describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { errorSchema } from "../../../../../errors/customError";
import type { HonoServer } from "../../../../../types";
import { requireProjectAccess } from "../../../../auth/middleware";
import { readDevToken, rotateDevToken } from "./service";

export const responseSchema = z.object({ token: z.string() });

const routeOptions = (operationId: string, description: string): DescribeRouteOptions => ({
	operationId,
	description,
	tags: ["Project Settings"],
	responses: {
		200: {
			description: "Successful",
			content: { "application/json": { schema: resolver(responseSchema) } },
		},
		404: {
			description: "Project not found",
			content: { "application/json": { schema: resolver(errorSchema) } },
		},
	},
});

/** The project's development access token (#734). */
export default function registerProjectDevToken(app: HonoServer) {
	const router = app.basePath("/:id/settings/dev-token");
	router.get(
		"/",
		describeRoute(
			routeOptions("project-dev-token-read", "Read the project's development access token"),
		),
		requireProjectAccess("creator", { key: "id", source: "param" }),
		async (c) => c.json(await readDevToken(c.req.param("id")!)),
	);
	router.post(
		"/rotate",
		describeRoute(
			routeOptions(
				"project-dev-token-rotate",
				"Replace the development access token; the old one stops working",
			),
		),
		requireProjectAccess("project_admin", { key: "id", source: "param" }),
		async (c) => c.json(await rotateDevToken(c.req.param("id")!)),
	);
}
