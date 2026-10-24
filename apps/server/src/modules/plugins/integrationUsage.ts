import type { FluxifyManifest } from "@fluxify/sdk/blocks";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { integrationsEntity } from "../../db/schema";
import { ConflictError } from "../../errors/conflictError";

/** an integration row of one of a plugin's kinds */
export type IntegrationUser = { id: string; name: string; group: string; variant: string };

/**
 * An integration as the upgrade diff sees it: its saved configs too, so a
 * narrowed number range can be checked against them. Never returned to a client.
 */
export type IntegrationConfigUser = IntegrationUser & {
	config?: unknown;
	devConfig?: unknown;
};

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

/**
 * `pluginIntegrationUsers` with the stored configs, for the upgrade diff: a
 * narrowed number range is checked against what each row saved. These hold
 * secrets, so this never leaves the server.
 */
export async function pluginIntegrationConfigUsers(
	projectId: string,
	...manifests: (FluxifyManifest | null | undefined)[]
): Promise<IntegrationConfigUser[]> {
	const users = await pluginIntegrationUsers(projectId, ...manifests);
	if (!users.length) return users;
	const rows = await db
		.select({
			id: integrationsEntity.id,
			config: integrationsEntity.config,
			devConfig: integrationsEntity.devConfig,
		})
		.from(integrationsEntity)
		.where(
			inArray(
				integrationsEntity.id,
				users.map((u) => u.id),
			),
		);
	const saved = new Map(rows.map((r) => [r.id, r]));
	return users.map((u) => ({
		...u,
		config: saved.get(u.id)?.config,
		devConfig: saved.get(u.id)?.devConfig,
	}));
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
