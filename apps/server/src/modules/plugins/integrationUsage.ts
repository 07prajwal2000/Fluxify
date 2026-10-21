import type { FluxifyManifest } from "@fluxify/sdk/blocks";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { integrationsEntity } from "../../db/schema";
import { ConflictError } from "../../errors/conflictError";

/** an integration row of one of a plugin's kinds */
export type IntegrationUser = { id: string; name: string; group: string; variant: string };

/** `group/variant`, the way a kind is written everywhere else */
export const kindOf = (e: { group: string; variant: string }) => `${e.group}/${e.variant}`;

/**
 * The project's integrations of any kind the manifests declare (I6), in every
 * environment: a row holds both environments' configs, so one row is one user.
 */
export async function pluginIntegrationUsers(
	projectId: string,
	...manifests: (FluxifyManifest | null | undefined)[]
): Promise<IntegrationUser[]> {
	const kinds = new Set(manifests.flatMap((m) => (m?.integrations ?? []).map(kindOf)));
	if (!kinds.size) return [];
	const groups = [...new Set([...kinds].map((k) => k.slice(0, k.lastIndexOf("/"))))];
	const rows = await db
		.select({
			id: integrationsEntity.id,
			name: integrationsEntity.name,
			group: integrationsEntity.group,
			variant: integrationsEntity.variant,
		})
		.from(integrationsEntity)
		.where(
			and(eq(integrationsEntity.projectId, projectId), inArray(integrationsEntity.group, groups)),
		);
	return rows
		.map((r) => ({
			id: r.id,
			name: r.name ?? r.id,
			group: r.group ?? "",
			variant: r.variant ?? "",
		}))
		.filter((r) => kinds.has(kindOf(r)))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** The 409 of a remove refused while integrations of the plugin's kinds exist. */
export class IntegrationsInUseError extends ConflictError {
	constructor(plugin: string, users: IntegrationUser[]) {
		super(
			`Plugin ${plugin} still provides integrations ${users.map((u) => `"${u.name}" (${kindOf(u)})`).join(", ")}. Delete them first.`,
		);
		this.details = { integrations: users };
	}
}
