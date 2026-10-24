import type { Param } from "@fluxify/sdk/blocks";
import { variantAllowed } from "@fluxify/sdk/integrations";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { integrationsEntity } from "../../db/schema";

/** the integrations of a project by id, for what a stored param value points at */
export type IntegrationKinds = ReadonlyMap<string, { group: string; variant: string }>;

/**
 * An integration param whose `variants` changed (the rule blocks and triggers
 * share): the line the diff lists, and whether a stored value no longer fits.
 * Breaking only for a value of a variant it dropped, so widening, or adding
 * `variants` that every value already fits, breaks nothing.
 */
export function variantsChange(name: string, before?: Param, after?: Param) {
	if (before?.type !== "integration" || after?.type !== "integration") return undefined;
	if (before.kind !== after.kind) return undefined; // a changed kind is its own line
	const was = before.variants;
	const now = after.variants;
	if (JSON.stringify(was ?? null) === JSON.stringify(now ?? null)) return undefined;
	return {
		change: now
			? `param ${name} now takes only ${now.join(", ")}`
			: `param ${name} now takes every variant`,
		drops: (value: unknown, kinds: IntegrationKinds) => {
			const found = typeof value === "string" ? kinds.get(value) : undefined;
			return !!found && !variantAllowed(now, found.group, found.variant);
		},
	};
}

/** every integration of the project, by id */
export async function projectIntegrationKinds(projectId: string): Promise<IntegrationKinds> {
	const rows = await db
		.select({
			id: integrationsEntity.id,
			group: integrationsEntity.group,
			variant: integrationsEntity.variant,
		})
		.from(integrationsEntity)
		.where(eq(integrationsEntity.projectId, projectId));
	return new Map(rows.map((r) => [r.id, { group: r.group ?? "", variant: r.variant ?? "" }]));
}
