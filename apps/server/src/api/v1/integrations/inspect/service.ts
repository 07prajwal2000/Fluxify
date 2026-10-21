import type { KvValueResult, SchemaDetails } from "@fluxify/adapters";
import type { z } from "zod";
import { BadRequestError } from "../../../../errors/badRequestError";
import { NotFoundError } from "../../../../errors/notFoundError";
import type { FluxifyEnv } from "../../../../lib/env";
import { runIntegrationOp } from "../../../../modules/integrationOps/dispatch";
import { ADMIN_CONNECTION_ENV, configForAdminEnv } from "../adminEnv";
import { getIntegrationByID } from "../get-by-id/repository";
import type { requestRouteSchema } from "./dto";

export { KV_VALUE_CAP } from "@fluxify/adapters";

type Params = z.infer<typeof requestRouteSchema>;

/**
 * Runs the integration's `inspect` hook (I3) with `env`'s config: here for a
 * built-in, on a worker of `env` otherwise. `group`, when given, is the only
 * group the caller accepts. Every failure is a readable 400 starting `what`.
 */
export async function inspectIntegration(
	params: Params,
	request: unknown,
	env: FluxifyEnv = ADMIN_CONNECTION_ENV,
	{ group, what = "Inspect failed" }: { group?: string; what?: string } = {},
) {
	const integration = await getIntegrationByID(params.projectId, params.integrationId);
	if (!integration) throw new NotFoundError("Integration not found");
	if (group && integration.group !== group) {
		throw new BadRequestError(`Not supported for ${integration.group} integrations`);
	}
	// development unless production is asked for: an agent or a stray click never reaches it by default
	const config = configForAdminEnv(integration, env);
	try {
		return await runIntegrationOp("inspect", {
			projectId: params.projectId,
			env,
			integrationId: integration.id,
			group: integration.group!,
			variant: integration.variant!,
			config,
			request,
		});
	} catch (error) {
		if (error instanceof BadRequestError) throw error;
		throw new BadRequestError(`${what}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export async function getSchemaDetails(params: Params, tables?: string): Promise<SchemaDetails> {
	const names = tables
		?.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	return (await inspectIntegration(params, { tables: names }, ADMIN_CONNECTION_ENV, {
		group: "database",
		what: "Failed to read schema",
	})) as SchemaDetails;
}

export async function getKvValue(
	params: Params,
	key: string,
	env: FluxifyEnv = ADMIN_CONNECTION_ENV,
): Promise<KvValueResult> {
	return (await inspectIntegration(params, { key }, env, {
		group: "kv",
		what: "Failed to read key",
	})) as KvValueResult;
}
