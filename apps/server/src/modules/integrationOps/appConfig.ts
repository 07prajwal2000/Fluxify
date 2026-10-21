import { SET_ONE } from "../../api/v1/integrations/adminEnv";
import { getAppConfigs } from "../../api/v1/integrations/test-connection/repository";
import { BadRequestError } from "../../errors/badRequestError";
import { EncryptionService } from "../../lib/encryption";
import type { FluxifyEnv } from "../../lib/env";
import { missingAppConfigMessage, pickValue } from "../../lib/envValues";

/** the referenced keys' values as `env` sees them, from the database; a key development has none for is a 400 */
export async function decodeAppConfig(keys: string[], projectId: string, env: FluxifyEnv) {
	const appConfigs = await getAppConfigs(keys, projectId);
	const configMap = new Map<string, string>();
	for (const config of appConfigs) {
		const stored = pickValue(env, config.syncDev, config.value, config.devValue);
		if (stored === null) {
			throw new BadRequestError(`${missingAppConfigMessage(config.key!)}. ${SET_ONE}`);
		}
		let value = EncryptionService.decodeData(stored, config.encodingType!);
		if (config.isEncrypted) value = EncryptionService.decrypt(value);
		configMap.set(config.key!, value);
	}
	return configMap;
}
