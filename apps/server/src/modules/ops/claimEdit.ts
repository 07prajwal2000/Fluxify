import { z } from "zod";
import { replicas } from "../../api/v1/orchestration/dto";
import { RPC_SUBJECTS, RpcError, rpcRespond } from "../../db/natsRpc";
import { claimMetadataSchema } from "../orchestrator/claimMetadata";
import { updateClaim } from "../orchestrator/claims";
import { toRpcError } from "./caller";

/**
 * `fluxify.ops.claim_edit` — an edit made on a Kubernetes `NodeClaim`, sent by
 * the orchestrator (#448). Only the fields that resource may change; the
 * checks are `updateClaim`'s, the same as the portal's.
 */
const editSchema = z.object({
	claimId: z.string().min(1),
	edit: z
		.object({
			replicas: replicas.optional(),
			maxReplicas: replicas.nullable().optional(),
			metadata: claimMetadataSchema.optional(),
		})
		.strict(),
});

export function registerClaimEditResponder() {
	return rpcRespond(RPC_SUBJECTS.claimEdit, async (payload: unknown) => {
		const parsed = editSchema.safeParse(payload);
		// Shown on the resource's status as is, so it says what was wrong, not just that something was.
		if (!parsed.success)
			throw new RpcError(
				"VALIDATION_FAILED",
				parsed.error.issues
					// Named as on the NodeClaim: `resources.cpu`, not the claim's `metadata.resources.cpu`.
					.map(
						(issue) =>
							`${issue.path
								.slice(1)
								.join(".")
								.replace(/^metadata\./, "")}: ${issue.message}`,
					)
					.join("; "),
			);
		try {
			await updateClaim(parsed.data.claimId, parsed.data.edit, { via: "nodeclaim" });
		} catch (error) {
			throw toRpcError(error);
		}
		return { ok: true };
	});
}
