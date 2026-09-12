import { describeRoute, resolver, validator } from "hono-openapi";
import { errorSchema } from "../../../errors/customError";
import { validationErrorSchema } from "../../../errors/validationError";
import zodErrorCallbackParser from "../../../middlewares/zodErrorCallbackParser";
import { createClaim, releaseClaim, updateClaim } from "../../../modules/orchestrator/claims";
import { requireOrchestration } from "../../../modules/orchestrator/gate";
import {
	readOrchestrationEvents,
	readOrchestrationStatus,
} from "../../../modules/orchestrator/status";
import { HonoServer } from "../../../types";
import { requireProjectAccess } from "../../auth/middleware";
import {
	claimAckSchema,
	createClaimBodySchema,
	eventsQuerySchema,
	eventsResponseSchema,
	orchestrationStatusSchema,
	patchClaimBodySchema,
} from "./dto";

/**
 * Where provisioning starts: a project asks for capacity (§3a). Mounted under
 * `/projects/:id/nodes`.
 *
 * Reading is a viewer's business, claiming is a project admin's — a claim
 * consumes a license slot and a slot of the operator's pool, which is not a
 * routine edit. Every route is behind the deployment-shape gate as well, so a
 * Kit build has no live endpoint behind its hidden UI (§5a).
 */

const json = (schema: Parameters<typeof resolver>[0]) => ({
	content: { "application/json": { schema: resolver(schema) } },
});

const errors = {
	400: { description: "Refused", ...json(validationErrorSchema) },
	401: { description: "Unauthorized", ...json(errorSchema) },
	403: { description: "Forbidden", ...json(errorSchema) },
	404: { description: "Not found, or orchestration is not available here", ...json(errorSchema) },
	500: { description: "Internal Server Error", ...json(errorSchema) },
};

const tags = ["Orchestration"];
const project = { source: "param" as const, key: "id" };

export default function registerProjectNodes(app: HonoServer) {
	const router = app.basePath("/:id/nodes");

	router.get(
		"/",
		describeRoute({
			description:
				"The nodes this project holds, the claims that asked for them, what is driving the infrastructure, and any trigger group with work and no healthy node.",
			operationId: "get-project-nodes",
			tags,
			responses: { 200: { description: "Successful", ...json(orchestrationStatusSchema) }, ...errors },
		}),
		requireOrchestration,
		requireProjectAccess("viewer", project),
		async (c) => c.json(await readOrchestrationStatus(c.req.param("id")!)),
	);

	router.get(
		"/events",
		describeRoute({
			description:
				"What the orchestrator has done to this project's nodes, newest first. Rows outlive the nodes they describe, so a removal is still accounted for.",
			operationId: "get-project-node-events",
			tags,
			responses: { 200: { description: "Successful", ...json(eventsResponseSchema) }, ...errors },
		}),
		requireOrchestration,
		requireProjectAccess("viewer", project),
		validator("query", eventsQuerySchema, zodErrorCallbackParser),
		async (c) =>
			c.json(
				await readOrchestrationEvents({
					projectId: c.req.param("id")!,
					limit: c.req.valid("query").limit,
				}),
			),
	);

	router.post(
		"/claims",
		describeRoute({
			description:
				"Claim a workload for this project: a node type, the trigger groups it serves, and how many identical replicas to run. Refused when the license does not allow it, or when a route claim has no subdomain to be reached on. A claim past the pool ceiling is accepted and sits pending.",
			operationId: "create-project-claim",
			tags,
			responses: { 200: { description: "Claimed", ...json(claimAckSchema) }, ...errors },
		}),
		requireOrchestration,
		requireProjectAccess("project_admin", project),
		validator("json", createClaimBodySchema, zodErrorCallbackParser),
		async (c) => {
			const user = c.get("user") as { id: string } | undefined;
			const claim = await createClaim(
				{ projectId: c.req.param("id")!, ...c.req.valid("json") },
				user?.id,
			);
			return c.json({
				id: claim.id,
				message: `Claimed ${claim.replicas} node(s). They appear within one reconcile pass.`,
			});
		},
	);

	router.patch(
		"/claims/:claimId",
		describeRoute({
			description:
				"Change a claim. Type and trigger groups reach a running node through the record it watches, so they apply with no restart; the replica count adds or removes containers, and scaling down drains what it removes. A claim's project cannot be changed — release it and claim again.",
			operationId: "update-project-claim",
			tags,
			responses: { 200: { description: "Updated", ...json(claimAckSchema) }, ...errors },
		}),
		requireOrchestration,
		requireProjectAccess("project_admin", project),
		validator("json", patchClaimBodySchema, zodErrorCallbackParser),
		async (c) => {
			const claim = await updateClaim(c.req.param("claimId")!, c.req.valid("json"), {
				projectId: c.req.param("id")!,
			});
			return c.json({ id: claim.id, message: "Claim updated." });
		},
	);

	router.delete(
		"/claims/:claimId",
		describeRoute({
			description:
				"Release a claim. Its nodes stop taking new work, finish what they are running, give up their license slots and stop. This takes that workload offline.",
			operationId: "release-project-claim",
			tags,
			responses: { 200: { description: "Releasing", ...json(claimAckSchema) }, ...errors },
		}),
		requireOrchestration,
		requireProjectAccess("project_admin", project),
		async (c) => {
			const released = await releaseClaim(c.req.param("claimId")!, {
				projectId: c.req.param("id")!,
			});
			return c.json({
				id: released.id,
				message: "Released. Its nodes drain and stop within one reconcile pass.",
			});
		},
	);
}
