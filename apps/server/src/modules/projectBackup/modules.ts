import { orderModules } from "./registry";
import { appConfigModule } from "./resources/appConfig";
import { customBlocksModule } from "./resources/customBlocks";
import { integrationsModule } from "./resources/integrations";
import { middlewaresModule } from "./resources/middlewares";
import { projectDependenciesModule } from "./resources/projectDependencies";
import { projectSettingsModule } from "./resources/projectSettings";
import { routesModule } from "./resources/routes";
import { triggersModule } from "./resources/triggers";
import { workflowsModule } from "./resources/workflows";
import type { BackupModule } from "./types";

/**
 * Every resource a project backup holds. Adding one is adding its module to
 * this list; the order is worked out from `dependsOn`, and a bad list fails at
 * startup. See README.md.
 */
export const BACKUP_MODULES: BackupModule[] = orderModules([
	appConfigModule,
	integrationsModule,
	projectSettingsModule,
	projectDependenciesModule,
	customBlocksModule,
	middlewaresModule,
	routesModule,
	workflowsModule,
	triggersModule,
] as BackupModule[]);
