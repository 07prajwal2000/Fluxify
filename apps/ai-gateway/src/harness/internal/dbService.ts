import {
	db,
	routesEntity,
	appConfigEntity,
	integrationsEntity,
	customBlocksListEntity,
	blocksEntity,
	edgesEntity,
	customBlockGraphsEntity,
} from "@fluxify/server";
import { eq, ilike, or, and, sql, inArray, type SQL } from "drizzle-orm";
import { logger } from "@fluxify/common";
import type {
	FindResourceResult,
	ResourceType,
} from "../../workflow/nodes/builder/types";

/**
 * Accepts either a single search string or an array of keywords, so the
 * agent can pass multiple terms in one call instead of retrying per keyword.
 */
export type SearchInput = string | string[];

export class DbService {
	constructor() {}

	/** Normalize search input into a de-duplicated list of non-empty keywords. */
	private normalizeKeywords(input: SearchInput): string[] {
		const arr = Array.isArray(input) ? input : [input];
		const seen = new Set<string>();
		for (const raw of arr) {
			const k = (raw ?? "").trim();
			if (k) seen.add(k);
		}
		return [...seen];
	}

	async findRoutes(
		projectId: string,
		searchQuery: SearchInput,
	): Promise<FindResourceResult[]> {
		try {
			const keywords = this.normalizeKeywords(searchQuery);
			if (keywords.length === 0) return [];

			const matchers: SQL[] = [];
			for (const k of keywords) {
				matchers.push(
					sql`to_tsvector('english', ${routesEntity.name}) @@ plainto_tsquery('english', ${k})`,
				);
				matchers.push(ilike(routesEntity.path, `%${k}%`));
			}

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
						or(...matchers),
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

	async getRouteDetails(
		projectId: string,
		routeId: string,
	): Promise<any | null> {
		try {
			const route = await db
				.select()
				.from(routesEntity)
				.where(
					and(
						eq(routesEntity.projectId, projectId),
						eq(routesEntity.id, routeId),
					),
				)
				.limit(1);
			return route.length > 0 ? route[0] : null;
		} catch (e) {
			logger.error("[DbService] Error getting route details", { error: e });
			return null;
		}
	}

	async findAppConfigs(
		projectId: string,
		searchQuery: SearchInput,
	): Promise<FindResourceResult[]> {
		try {
			const keywords = this.normalizeKeywords(searchQuery);
			if (keywords.length === 0) return [];

			const matchers: SQL[] = [];
			for (const k of keywords) {
				matchers.push(
					sql`to_tsvector('english', ${appConfigEntity.keyName}) @@ plainto_tsquery('english', ${k})`,
				);
				matchers.push(
					sql`to_tsvector('english', coalesce(${appConfigEntity.description}, '')) @@ plainto_tsquery('english', ${k})`,
				);
			}

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
						or(...matchers),
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
		searchQuery: SearchInput,
	): Promise<FindResourceResult[]> {
		try {
			const keywords = this.normalizeKeywords(searchQuery);
			if (keywords.length === 0) return [];

			const matchers: SQL[] = keywords.map(
				(k) =>
					sql`to_tsvector('english', ${integrationsEntity.name}) @@ plainto_tsquery('english', ${k})`,
			);

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
						or(...matchers),
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
		searchQuery: SearchInput,
	): Promise<FindResourceResult[]> {
		try {
			const keywords = this.normalizeKeywords(searchQuery);
			if (keywords.length === 0) return [];

			const matchers: SQL[] = [];
			for (const k of keywords) {
				matchers.push(ilike(customBlocksListEntity.name, `%${k}%`));
				matchers.push(ilike(customBlocksListEntity.label, `%${k}%`));
			}

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
						or(...matchers),
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

	async getRouteCanvas(
		projectId: string,
		routeId: string,
	): Promise<any | null> {
		try {
			const [blocks, edges] = await Promise.all([
				db.select().from(blocksEntity).where(eq(blocksEntity.routeId, routeId)),
				db.select().from(edgesEntity).where(eq(edgesEntity.routeId, routeId)),
			]);

			return blocks.map((block) => {
				const blockData = (block.data as Record<string, any>) ?? {};
				const connections = edges
					.filter((e) => e.from === block.id && e.to)
					.map((e) => ({
						blockId: e.to!,
						handle: e.fromHandle ?? "source",
					}));

				return {
					id: block.id,
					blockType: block.type ?? "unknown",
					blockName: blockData.blockName ?? undefined,
					blockDescription: blockData.blockDescription ?? undefined,
					data: blockData,
					position: block.position ?? { x: 0, y: 0 },
					connections,
				};
			});
		} catch (e) {
			logger.error("[DbService] Error getting route canvas", { error: e });
			return null;
		}
	}

	async getCustomBlockCanvas(
		projectId: string,
		blockId: string,
	): Promise<any | null> {
		try {
			const blocks = await db
				.select()
				.from(customBlockGraphsEntity)
				.where(eq(customBlockGraphsEntity.customBlockId, blockId));
			
			return blocks.map((block) => {
				const connections = block.next ? [{ blockId: block.next, handle: "source" }] : [];
				return {
					id: block.id,
					blockType: block.type ?? "unknown",
					data: block.data ?? {},
					connections,
				};
			});
		} catch (e) {
			logger.error("[DbService] Error getting custom block canvas", { error: e });
			return null;
		}
	}

	async getAllCustomBlocks(projectId: string): Promise<{ name: string; label: string; description: string }[]> {
		try {
			const customBlocks = await db
				.select({
					name: customBlocksListEntity.name,
					label: customBlocksListEntity.label,
					description: customBlocksListEntity.description,
				})
				.from(customBlocksListEntity)
				.where(
					or(
						eq(customBlocksListEntity.projectId, projectId),
						eq(customBlocksListEntity.sourceType, "inhouse"),
					),
				);
			return customBlocks.map((c) => ({
				name: c.name,
				label: c.label || c.name,
				description: c.description || "",
			}));
		} catch (e) {
			logger.error("[DbService] Error getting all custom blocks", { error: e });
			return [];
		}
	}

	async getCustomBlockInputParams(projectId: string, name: string): Promise<any[] | null> {
		try {
			const block = await db
				.select({ inputParams: customBlocksListEntity.inputParams })
				.from(customBlocksListEntity)
				.where(
					and(
						eq(customBlocksListEntity.name, name),
						or(
							eq(customBlocksListEntity.projectId, projectId),
							eq(customBlocksListEntity.sourceType, "inhouse"),
						),
					),
				)
				.limit(1);
			return block.length > 0 ? (block[0].inputParams as any[]) : null;
		} catch (e) {
			logger.error("[DbService] Error getting custom block input params", { error: e });
			return null;
		}
	}

	async getCustomBlocksBatch(
		projectId: string,
		names: string[],
	): Promise<Map<string, any[]>> {
		const resultMap = new Map<string, any[]>();
		if (!names || names.length === 0) return resultMap;
		try {
			const blocks = await db
				.select({
					name: customBlocksListEntity.name,
					inputParams: customBlocksListEntity.inputParams,
				})
				.from(customBlocksListEntity)
				.where(
					and(
						inArray(customBlocksListEntity.name, names),
						or(
							eq(customBlocksListEntity.projectId, projectId),
							eq(customBlocksListEntity.sourceType, "inhouse"),
						),
					),
				);
			for (const b of blocks) {
				resultMap.set(b.name, (b.inputParams as any[]) || []);
			}
			return resultMap;
		} catch (e) {
			logger.error("[DbService] Error getting custom blocks batch", { error: e });
			return resultMap;
		}
	}
}
