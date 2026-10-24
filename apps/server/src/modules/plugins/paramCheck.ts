import type { Param } from "@fluxify/sdk/blocks";
import { integrationKindCovers, variantAllowed } from "@fluxify/sdk/integrations";
import { eq } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import { integrationsEntity } from "../../db/schema";

/**
 * What every plugin resource kind with params (a block on a canvas, a plugin
 * trigger) checks of an `integration` param's value, written once: the
 * integration belongs to the project, is of the param's kind and one of its
 * `variants`, and the resource was granted it.
 */

type IntegrationParam = Extract<Param, { type: "integration" }>;
export type ParamOwner = { label: string; granted: readonly string[] };
export type Found = { name: string; group: string; variant: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** the integration `id` names in `projectId`, or undefined */
export async function projectIntegration(
	id: string,
	projectId: string,
	tx?: DbTransactionType,
): Promise<Found | undefined> {
	// the id column is a uuid: anything else is an error from Postgres, not a 400
	if (!UUID.test(id)) return undefined;
	const [row] = await (tx ?? db)
		.select({
			projectId: integrationsEntity.projectId,
			name: integrationsEntity.name,
			group: integrationsEntity.group,
			variant: integrationsEntity.variant,
		})
		.from(integrationsEntity)
		.where(eq(integrationsEntity.id, id))
		.limit(1);
	if (!row || (row.projectId ?? projectId) !== projectId) return undefined;
	return { name: row.name ?? id, group: row.group ?? "", variant: row.variant ?? "" };
}

/** why `param` cannot take `integration`, or undefined when it can */
export function integrationParamProblem(
	owner: ParamOwner,
	param: IntegrationParam,
	{ name, group, variant }: Found,
) {
	if (!integrationKindCovers(param.kind, group, variant))
		return `integration "${name}" is ${group}/${variant}, not a ${param.kind}`;
	if (!variantAllowed(param.variants, group, variant))
		return `integration "${name}" is ${variant}; this field takes only ${param.variants!.join(", ")}`;
	if (!owner.granted.some((k) => integrationKindCovers(k, group, variant)))
		return `${owner.label} was not granted ${group}/${variant} integrations`;
}
