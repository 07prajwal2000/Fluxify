import { NotFoundError } from "../../../../../errors/notFoundError";
import { EncryptionService } from "../../../../../lib/encryption";
import { publishProjectConfig } from "../../../../../modules/compiler/projectConfig";
import { generateDevToken, hashDevToken } from "../../../../../modules/requestRouter/devToken";
import { checkProjectExists } from "../keys/get-all/repository";
import { findDevToken, insertDevToken, replaceDevToken } from "./repository";

/**
 * The project's token, made on first ask: projects created before the token
 * existed, and seeded ones, have none.
 */
async function ensureDevToken(projectId: string) {
	const sealed = await findDevToken(projectId);
	if (sealed) return { token: EncryptionService.decrypt(sealed), created: false };

	const token = generateDevToken();
	if (await insertDevToken(projectId, EncryptionService.encrypt(token))) {
		return { token, created: true };
	}
	// another request made one between our read and our insert
	return { token: EncryptionService.decrypt((await findDevToken(projectId))!), created: false };
}

async function assertProjectExists(projectId: string) {
	if (!(await checkProjectExists(projectId))) throw new NotFoundError("Project not found");
}

export async function readDevToken(projectId: string) {
	await assertProjectExists(projectId);
	const { token, created } = await ensureDevToken(projectId);
	// a token the dev workers have never heard of would be copied, then refused
	if (created) await publishProjectConfig(projectId);
	return { token };
}

export async function rotateDevToken(projectId: string) {
	await assertProjectExists(projectId);
	const token = generateDevToken();
	await replaceDevToken(projectId, EncryptionService.encrypt(token));
	// the old hash must leave the dev bucket before the caller hears it changed
	await publishProjectConfig(projectId);
	return { token };
}

/** What the development config carries; the token itself never leaves the admin. */
export async function getDevTokenHash(projectId: string) {
	return hashDevToken((await ensureDevToken(projectId)).token);
}
