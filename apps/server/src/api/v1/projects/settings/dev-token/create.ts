import type { DbTransactionType } from "../../../../../db";
import { EncryptionService } from "../../../../../lib/encryption";
import { generateDevToken } from "../../../../../modules/requestRouter/devToken";
import { insertDevToken } from "./repository";

/** Its own file so project creation does not pull in the config publisher. */
export async function createDevToken(projectId: string, tx?: DbTransactionType) {
	await insertDevToken(projectId, EncryptionService.encrypt(generateDevToken()), tx);
}
