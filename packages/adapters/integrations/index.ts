import { createHash } from "node:crypto";
import { UnknownIntegrationVariantError } from "@fluxify/sdk/integrations";
import { BUILT_IN_VARIANTS } from "./builtins";
import { IntegrationRegistry } from "./registry";

export { BUILT_IN_VARIANTS } from "./builtins";
export * from "./builtinVariants";
export * from "./ops";
export { IntegrationRegistry } from "./registry";
export { appConfigKeys, appConfigMap, expandStoredConfig } from "./resolve";

/**
 * The process's integration variants: every built-in, plus what plugins
 * register at runtime (I6). Every factory resolves adapters through it.
 */
export const integrationRegistry = new IntegrationRegistry(BUILT_IN_VARIANTS);

/**
 * The project a resolved config belongs to (the loader's `__projectId`), which
 * decides whose plugin variants it can resolve to. Unowned: shared variants only.
 */
export const configOwner = (config: unknown): string | undefined =>
	((config as Record<string, unknown> | null)?.__projectId as string | null) ?? undefined;

/**
 * A plugin variant's `poolKey` for a resolved config, hashed with what else
 * decides the client; undefined for a variant without one (every built-in).
 */
export function poolKeyFingerprint(
	def: { poolKey?(config: never): unknown } | undefined,
	config: Record<string, unknown>,
) {
	if (!def?.poolKey) return undefined;
	const material = JSON.stringify({ variant: config.variant, key: def.poolKey(config as never) });
	return createHash("sha256").update(material).digest("hex");
}

/**
 * The database variant a runtime `Connection` belongs to. The cached config
 * names its driver by `dbType`, which every database variant declares.
 */
export function databaseVariantFor(dbType: string, projectId?: string) {
	const type = String(dbType).toLowerCase();
	const def = integrationRegistry
		.variants("database", projectId)
		.find((variant) => variant.extras.dbType.toLowerCase() === type);
	if (!def) throw new UnknownIntegrationVariantError("database", dbType);
	return def;
}
