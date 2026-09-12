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
import { requireSystemAdmin } from "../../auth/middleware";
import {
	claimAckSchema,
	createInstanceClaimBodySchema,
	eventsQuerySchema,
	eventsResponseSchema,
	orchestrationStatusSchema,
	patchClaimBodySchema,
} from "./dto";

/**
 * The operator's half (§14.5): every node, which project each serves, and the
 * pool they all fit in. Mounted under `/instance-settings/orchestration`.
 *
 * The pool ceiling itself is not here — it is the `orchestration_pool` instance
 * setting, written through the existing settings endpoint, which already gives
 * it Postgres persistence, the KV fan-out to every process and a boot reconcile.
 * A second write path for one number would only be a way for the two to
 * disagree.
 *
 * Claims are writable here too, because the catch-all claim a fresh instance is
 * seeded with belongs to no project and would otherwise be impossible to scale
 * or retire from any surface at all.
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

export default function registerOrchestrationRoutes(app: HonoServer) {
	app.get(
		"/orchestration",
		describeRoute({
			description:
				"Every node on this instance with the project it serves, pool usage against the declared ceiling, what the license allows, which infrastructure is being driven, and any trigger group with work and no healthy node.",
			operationId: "get-orchestration",
			tags,
			responses: { 200: { description: "Successful", ...json(orchestrationStatusSchema) }, ...errors },
		}),
		requireOrchestration,
		requireSystemAdmin,
		async (c) => c.json(await readOrchestrationStatus()),
	);

	app.get(
		"/orchestration/events",
		describeRoute({
			description:
				"Everything the orchestrator has done, newest first: containers created, recreated, drained and removed, and the claims behind them.",
			operationId: "get-orchestration-events",
			tags,
			responses: { 200: { description: "Successful", ...json(eventsResponseSchema) }, ...errors },
		}),
		requireOrchestration,
		requireSystemAdmin,
		validator("query", eventsQuerySchema, zodErrorCallbackParser),
		async (c) => c.json(await readOrchestrationEvents({ limit: c.req.valid("query").limit })),
	);

	app.post(
		"/orchestration/claims",
		describeRoute({
			description:
				"Write a claim from the operator's side. A null project is the catch-all — one workload serving every project, which is the shape a fresh instance is seeded with.",
			operationId: "create-instance-claim",
			tags,
			responses: { 200: { description: "Claimed", ...json(claimAckSchema) }, ...errors },
		}),
		requireOrchestration,
		requireSystemAdmin,
		validator("json", createInstanceClaimBodySchema, zodErrorCallbackParser),
		async (c) => {
			const user = c.get("user") as { id: string } | undefined;
			const claim = await createClaim(c.req.valid("json"), user?.id);
			return c.json({
				id: claim.id,
				message: `Claimed ${claim.replicas} node(s). They appear within one reconcile pass.`,
			});
		},
	);

	app.patch(
		"/orchestration/claims/:claimId",
		describeRoute({
			description:
				"Change any claim on the instance. Type and trigger groups apply in place through the record each node watches; the replica count adds or removes containers, draining what it removes.",
			operationId: "update-instance-claim",
			tags,
			responses: { 200: { description: "Updated", ...json(claimAckSchema) }, ...errors },
		}),
		requireOrchestration,
		requireSystemAdmin,
		validator("json", patchClaimBodySchema, zodErrorCallbackParser),
		async (c) => {
			const claim = await updateClaim(c.req.param("claimId")!, c.req.valid("json"));
			return c.json({ id: claim.id, message: "Claim updated." });
		},
	);

	app.delete(
		"/orchestration/claims/:claimId",
		describeRoute({
			description:
				"Release any claim on the instance. Its nodes fail readiness, finish in-flight work, give up their license slots and stop.",
			operationId: "release-instance-claim",
			tags,
			responses: { 200: { description: "Releasing", ...json(claimAckSchema) }, ...errors },
		}),
		requireOrchestration,
		requireSystemAdmin,
		async (c) => {
			const released = await releaseClaim(c.req.param("claimId")!);
			return c.json({
				id: released.id,
				message: "Released. Its nodes drain and stop within one reconcile pass.",
			});
		},
	);
}
