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
 * The database variant a runtime `Connection` belongs to. The cached config
 * names its driver by `dbType`, which every database variant declares.
 */
export function databaseVariantFor(dbType: string) {
	const type = String(dbType).toLowerCase();
	const def = integrationRegistry
		.variants("database")
		.find((variant) => variant.extras.dbType.toLowerCase() === type);
	if (!def) throw new UnknownIntegrationVariantError("database", dbType);
	return def;
}
