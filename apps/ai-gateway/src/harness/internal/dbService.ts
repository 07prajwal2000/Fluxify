import {
	db,
	routesEntity,
	appConfigEntity,
	integrationsEntity,
	customBlocksListEntity,
} from "@fluxify/server";
import { eq, ilike, or, and } from "drizzle-orm";
import { logger } from "@fluxify/common";
import type {
	FindResourceResult,
	ResourceType,
} from "../../workflow/nodes/builder/types";

export class DbService {
	constructor() {}

	async findRoutes(
		projectId: string,
		searchQuery: string,
	): Promise<FindResourceResult[]> {
		try {
			const routes = await db
				.select({
					id: routesEntity.id,
					name: routesEntity.name,
					path: routesEntity.path,
					method: routesEntity.method,
				})
				.from(routesEntity)
				.where(
					and(
						eq(routesEntity.projectId, projectId),
						or(
							ilike(routesEntity.name, `%${searchQuery}%`),
							ilike(routesEntity.path, `%${searchQuery}%`),
						),
					),
				)
				.limit(10);
			return routes.map((r) => ({
				type: "route",
				id: r.id,
				name: r.name || "",
				path: r.path || "",
				method: r.method || "",
			}));
		} catch (e) {
			logger.error("[DbService] Error searching routes", { error: e });
			return [];
		}
	}

	async findAppConfigs(
		projectId: string,
		searchQuery: string,
	): Promise<FindResourceResult[]> {
		try {
			const configs = await db
				.select({
					id: appConfigEntity.id,
					name: appConfigEntity.keyName,
					description: appConfigEntity.description,
				})
				.from(appConfigEntity)
				.where(
					and(
						eq(appConfigEntity.projectId, projectId),
						or(
							ilike(appConfigEntity.keyName, `%${searchQuery}%`),
							ilike(appConfigEntity.description, `%${searchQuery}%`),
						),
					),
				)
				.limit(10);
			return configs.map((c) => ({
				type: "app_config",
				id: c.id.toString(),
				name: c.name || "",
				description: c.description || "",
			}));
		} catch (e) {
			logger.error("[DbService] Error searching app configs", { error: e });
			return [];
		}
	}

	async findIntegrations(
		projectId: string,
		searchQuery: string,
	): Promise<FindResourceResult[]> {
		try {
			const integrations = await db
				.select({
					id: integrationsEntity.id,
					name: integrationsEntity.name,
					group: integrationsEntity.group,
					variant: integrationsEntity.variant,
				})
				.from(integrationsEntity)
				.where(
					and(
						eq(integrationsEntity.projectId, projectId),
						ilike(integrationsEntity.name, `%${searchQuery}%`),
					),
				)
				.limit(10);
			return integrations.map((i) => ({
				type: "integration",
				id: i.id,
				name: i.name || "",
				group: i.group || "",
				variant: i.variant || "",
			}));
		} catch (e) {
			logger.error("[DbService] Error searching integrations", { error: e });
			return [];
		}
	}

	async findCustomBlocks(
		projectId: string,
		searchQuery: string,
	): Promise<FindResourceResult[]> {
		try {
			const customBlocks = await db
				.select({
					id: customBlocksListEntity.id,
					name: customBlocksListEntity.name,
					description: customBlocksListEntity.description,
				})
				.from(customBlocksListEntity)
				.where(
					and(
						or(
							eq(customBlocksListEntity.projectId, projectId),
							eq(customBlocksListEntity.sourceType, "inhouse"),
						),
						or(
							ilike(customBlocksListEntity.name, `%${searchQuery}%`),
							ilike(customBlocksListEntity.label, `%${searchQuery}%`),
						),
					),
				)
				.limit(10);
			return customBlocks.map((c) => ({
				type: "custom_block",
				id: c.id,
				name: c.name,
				description: c.description || "",
			}));
		} catch (e) {
			logger.error("[DbService] Error searching custom blocks", { error: e });
			return [];
		}
	}
}
