import { zValidator } from "@hono/zod-validator";
import { zodErrorCallbackParser } from "@fluxify/server";
import type { Hono } from "hono";
import { verifyHarnessConversationOwner, verifyProjectAccess } from "../middleware";
import {
	artifactParamsSchema,
	runParamsSchema,
	subArtifactParamsSchema,
} from "./dto";
import {
	applyArtifact,
	applySubArtifact,
	getSubArtifact,
	listRunSubArtifacts,
} from "./service";

export default function (app: Hono) {
	app.get(
		"/:conversationId/sub-artifacts/:subArtifactId",
		zValidator("param", subArtifactParamsSchema, zodErrorCallbackParser),
		verifyProjectAccess("viewer"),
		verifyHarnessConversationOwner,
		async (c: any) => {
			const param = c.req.valid("param");
			return c.json(await getSubArtifact(param.conversationId, param.subArtifactId));
		},
	);

	app.get(
		"/:conversationId/runs/:runId/sub-artifacts",
		zValidator("param", runParamsSchema, zodErrorCallbackParser),
		verifyProjectAccess("viewer"),
		verifyHarnessConversationOwner,
		async (c: any) => {
			const param = c.req.valid("param");
			return c.json(await listRunSubArtifacts(param.conversationId, param.runId));
		},
	);

	app.post(
		"/:conversationId/sub-artifacts/:subArtifactId/apply",
		zValidator("param", subArtifactParamsSchema, zodErrorCallbackParser),
		verifyProjectAccess("creator"),
		verifyHarnessConversationOwner,
		async (c: any) => {
			const param = c.req.valid("param");
			return c.json(
				await applySubArtifact(
					param.conversationId,
					param.projectId,
					param.subArtifactId,
				),
			);
		},
	);

	app.post(
		"/:conversationId/artifacts/:artifactId/apply",
		zValidator("param", artifactParamsSchema, zodErrorCallbackParser),
		verifyProjectAccess("creator"),
		verifyHarnessConversationOwner,
		async (c: any) => {
			const param = c.req.valid("param");
			return c.json(
				await applyArtifact(param.conversationId, param.projectId, param.artifactId),
			);
		},
	);
}
