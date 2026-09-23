import { logger } from "@fluxify/common";
import { RPC_SUBJECTS, RpcError, rpcRequest } from "../../db/natsRpc";
import type { ClaimEdit, ForwardEdit } from "./nodeClaims";

/**
 * An edit made on a `NodeClaim`, handed to admin (#448). Admin is the only
 * writer of claims (§2), so the orchestrator asks rather than writes: the edit
 * goes through `updateClaim` with the portal's own checks.
 *
 * A refusal is admin's answer and ends up on the resource. Admin being down or
 * failing is not an answer, so the edit is left to be asked again.
 */
export const forwardClaimEdit: ForwardEdit = async (claimId, edit) => {
	try {
		await rpcRequest<{ claimId: string; edit: ClaimEdit }, unknown>(
			RPC_SUBJECTS.claimEdit,
			{ userId: "system", projectIds: [] },
			{ claimId, edit },
			// Edits are asked one at a time inside the pass, so a hung admin must
			// not hold the next pass for long.
			5_000,
		);
		return { ok: true };
	} catch (error) {
		if (error instanceof RpcError && error.code !== "TIMEOUT" && error.code !== "INTERNAL")
			return { ok: false, message: error.message };
		logger.warn(`claim ${claimId}: edit not delivered: ${String(error)}`, "ORCHESTRATOR");
		return null;
	}
};
