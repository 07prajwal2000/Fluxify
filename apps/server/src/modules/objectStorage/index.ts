import { expandCfg } from "@fluxify/adapters";
import { appConfigKeys, integrationRegistry } from "@fluxify/adapters/integrations";
import type { ObjectStorageAdapter } from "@fluxify/sdk/integrations";
import { configForAdminEnv } from "../../api/v1/integrations/adminEnv";
import { getIntegrationById } from "../../api/v1/integrations/test-existing-connection/repository";
import { BadRequestError } from "../../errors/badRequestError";
import { NotFoundError } from "../../errors/notFoundError";
import type { FluxifyEnv } from "../../lib/env";
import { decodeAppConfig } from "../integrationOps/appConfig";

/** integration id + env -> the adapter, and the hash of the config it was made from */
const clients = new Map<string, { hash: bigint | number; storage: ObjectStorageAdapter }>();

/**
 * A project's Object Storage integration as an adapter, `cfg:` references read
 * from `env`'s app config (production unless asked). Read fresh from the row on
 * every call, so an edited integration takes effect at once; the client itself
 * is reused until its resolved config changes.
 *
 * ponytail: cached clients are never evicted. Fine for a handful of backup
 * destinations; add an idle sweep if many projects back up from one admin.
 */
export async function openObjectStorage(
	projectId: string,
	integrationId: string,
	env: FluxifyEnv = "production",
): Promise<ObjectStorageAdapter> {
	const row = await getIntegrationById(projectId, integrationId);
	if (!row)
		throw new NotFoundError(`Integration ${integrationId} not found in project ${projectId}`);
	if (row.group !== "storage")
		throw new BadRequestError(`Integration ${row.name} is not an Object Storage integration`);
	const def = integrationRegistry.get("storage", row.variant ?? "", projectId);
	if (!def?.create)
		throw new BadRequestError(`Object Storage provider "${row.variant}" is not available`);

	const stored = configForAdminEnv(row, env) as Record<string, unknown>;
	const appConfig = await decodeAppConfig(appConfigKeys(stored), projectId, env);
	const config = expandCfg(stored, appConfig);

	const key = `${integrationId}:${env}`;
	const hash = Bun.hash(`${row.variant}\n${JSON.stringify(config)}`);
	const cached = clients.get(key);
	if (cached?.hash === hash) return cached.storage;
	const storage = def.create(config, {}) as ObjectStorageAdapter;
	clients.set(key, { hash, storage });
	return storage;
}
