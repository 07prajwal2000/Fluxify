import {
	db,
	routesEntity,
	appConfigEntity,
	integrationsEntity,
	customBlocksListEntity,
	blocksEntity,
	edgesEntity,
	agentHarnessSubArtifactsEntity,
} from "@fluxify/server";
import { eq, ilike, or, and, sql, inArray, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { logger } from "@fluxify/common";
import { FindResourceResult } from "../types";

/**
 * Accepts either a single search string or an array of keywords, so the
 * agent can pass multiple terms in one call instead of retrying per keyword.
 */
export type SearchInput = string | string[];

/**
 * `"id"` looks the input up as an exact resource id, `"keyword"` full-text
 * searches names and descriptions. The caller says which — an id and a search
 * term are different intents, and guessing from the string's shape hides that
 * from both the model and the trace.
 */
export type SearchMode = "keyword" | "id";

export interface SubArtifactRecord {
	id: string;
	artifactId: string;
	runId: string;
	kind: string;
	action: string | null;
	/** Null until the user applies this output to the project. */
	appliedAt: Date | null;
	payload: Record<string, any>;
	createdAt: Date;
}

/**
 * Free text -> a prefix tsquery: `"data ur"` becomes `data:* & ur:*`, so typing
 * part of a word finds it. `plainto_tsquery` can't do this — it only matches
 * whole lexemes, which meant "data" missed `DATABASE_URL`.
 *
 * Everything that isn't a word character is dropped rather than escaped:
 * `to_tsquery` throws on stray operators (`&`, `!`, unbalanced quotes) and this
 * string comes straight off a user's keyboard. Dropping them also splits
 * `/api/users` into its segments for free.
 *
 * Returns null when nothing searchable is left, so the caller can skip the query.
 */
export function toPrefixTsQuery(keyword: string): string | null {
	const terms = keyword.toLowerCase().match(/[a-z0-9]+/g);
	return terms?.length ? terms.map((t) => `${t}:*`).join(" & ") : null;
}

export const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INTEGER = /^\d+$/;

/**
 * Which keywords are safe to compare against a typed id column. Postgres
 * errors outright on `uuid = 'auth'` or `serial = 'auth'`, and the caller
 * swallows errors into an empty result — so one ordinary word in the list
 * would silently blank out the whole search.
 */
export function idLookups(keywords: string[], accept?: RegExp): string[] {
	return accept ? keywords.filter((k) => accept.test(k)) : keywords;
}

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

	/** Same, as prefix tsqueries — the FTS lookups all want these. Empty in id
	 *  mode: an exact lookup should not also drag in fuzzy name matches. */
	private tsQueries(input: SearchInput, mode: SearchMode): string[] {
		if (mode === "id") return [];
		return [
			...new Set(
				this.normalizeKeywords(input)
					.map(toPrefixTsQuery)
					.filter((q): q is string => !!q),
			),
		];
	}

	/**
	 * An id the harness itself issued is the one input FTS cannot resolve:
	 * `toPrefixTsQuery` turns a uuid into hex prefix terms and matches them
	 * against the *name* column. The planner hands ids to sub-agents in task
	 * descriptions and writes them into `:resource{}` markup, so those lookups
	 * came back empty and the agent told the user the resource was gone.
	 *
	 * Returned empty in keyword mode: the id column is only searched when the
	 * caller asked for an id lookup, so a fuzzy search stays fuzzy and the
	 * trace shows which of the two the agent meant.
	 */
	private idMatchers(
		column: PgColumn,
		keywords: string[],
		mode: SearchMode,
		accept?: RegExp,
	): SQL[] {
		if (mode !== "id") return [];
		return idLookups(keywords, accept).map((k) => sql`${column} = ${k}`);
	}

	async findRoutes(
		projectId: string,
		searchQuery: SearchInput,
		mode: SearchMode = "keyword",
	): Promise<FindResourceResult[]> {
		try {
			const matchers: SQL[] = this.idMatchers(
				routesEntity.id,
				this.normalizeKeywords(searchQuery),
				mode,
			);
			for (const q of this.tsQueries(searchQuery, mode)) {
				matchers.push(
					sql`to_tsvector('english', ${routesEntity.name}) @@ to_tsquery('english', ${q})`,
				);
				// The path needs its separators flattened or "/api/users" stays a
				// single token. Mirrors `idx_routes_path_fts`.
				matchers.push(
					sql`to_tsvector('english', translate(coalesce(${routesEntity.path}, ''), '/:-_', '    ')) @@ to_tsquery('english', ${q})`,
				);
			}
			if (matchers.length === 0) return [];

			const routes = await db
				.select({
					id: routesEntity.id,
					name: routesEntity.name,
					path: routesEntity.path,
					method: routesEntity.method,
				})
				.from(routesEntity)
				.where(and(eq(routesEntity.projectId, projectId), or(...matchers)))
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
		mode: SearchMode = "keyword",
	): Promise<FindResourceResult[]> {
		try {
			const matchers: SQL[] = this.idMatchers(
				appConfigEntity.id,
				this.normalizeKeywords(searchQuery),
				mode,
				INTEGER,
			);
			for (const q of this.tsQueries(searchQuery, mode)) {
				matchers.push(
					sql`to_tsvector('english', ${appConfigEntity.keyName}) @@ to_tsquery('english', ${q})`,
				);
				matchers.push(
					sql`to_tsvector('english', coalesce(${appConfigEntity.description}, '')) @@ to_tsquery('english', ${q})`,
				);
			}
			if (matchers.length === 0) return [];

			const configs = await db
				.select({
					id: appConfigEntity.id,
					name: appConfigEntity.keyName,
					description: appConfigEntity.description,
				})
				.from(appConfigEntity)
				.where(and(eq(appConfigEntity.projectId, projectId), or(...matchers)))
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
		mode: SearchMode = "keyword",
	): Promise<FindResourceResult[]> {
		try {
			const matchers: SQL[] = this.idMatchers(
				integrationsEntity.id,
				this.normalizeKeywords(searchQuery),
				mode,
				UUID,
			);
			for (const q of this.tsQueries(searchQuery, mode)) {
				matchers.push(
					sql`to_tsvector('english', ${integrationsEntity.name}) @@ to_tsquery('english', ${q})`,
				);
				// "postgres" / "openai" — what the integration is, not what it's called.
				matchers.push(
					sql`to_tsvector('english', coalesce(${integrationsEntity.group}, '') || ' ' || coalesce(${integrationsEntity.variant}, '') || ' ' || coalesce(${integrationsEntity.tags}, '')) @@ to_tsquery('english', ${q})`,
				);
			}
			if (matchers.length === 0) return [];

			const integrations = await db
				.select({
					id: integrationsEntity.id,
					name: integrationsEntity.name,
					group: integrationsEntity.group,
					variant: integrationsEntity.variant,
				})
				.from(integrationsEntity)
				.where(
					and(eq(integrationsEntity.projectId, projectId), or(...matchers)),
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
		mode: SearchMode = "keyword",
	): Promise<FindResourceResult[]> {
		try {
			const keywords = this.normalizeKeywords(searchQuery);
			if (keywords.length === 0) return [];

			const matchers: SQL[] = this.idMatchers(
				customBlocksListEntity.id,
				keywords,
				mode,
			);
			for (const k of mode === "id" ? [] : keywords) {
				matchers.push(ilike(customBlocksListEntity.name, `%${k}%`));
				matchers.push(ilike(customBlocksListEntity.label, `%${k}%`));
			}
			if (matchers.length === 0) return [];

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
		return this.getCanvas("route", routeId);
	}

	/** route and custom block canvases are the same graph, read the same way */
	private async getCanvas(
		parentType: "route" | "custom_block",
		parentId: string,
	): Promise<any | null> {
		try {
			const owns = (table: typeof blocksEntity | typeof edgesEntity) =>
				and(
					eq(table.parentType, parentType),
					eq(table.parentId, parentId),
				);
			const [blocks, edges] = await Promise.all([
				db.select().from(blocksEntity).where(owns(blocksEntity)),
				db.select().from(edgesEntity).where(owns(edgesEntity)),
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
			logger.error("[DbService] Error getting canvas", { error: e });
			return null;
		}
	}

	async getCustomBlockCanvas(
		projectId: string,
		blockId: string,
	): Promise<any | null> {
		return this.getCanvas("custom_block", blockId);
	}

	/**
	 * Fetches persisted sub-agent outputs (sub-artifacts) from past runs.
	 * `ids` may be sub-artifact ids (the ones embedded in summary tokens) or a
	 * parent artifact id, in which case all its children are returned. Always
	 * scoped to the conversation so one chat can never read another's artifacts.
	 */
	async getSubArtifacts(
		conversationId: string,
		ids: string[],
	): Promise<SubArtifactRecord[]> {
		try {
			const clean = this.normalizeKeywords(ids);
			// No conversation scope => never widen the query, just return nothing.
			if (!conversationId || clean.length === 0) return [];

			return await db
				.select({
					id: agentHarnessSubArtifactsEntity.id,
					artifactId: agentHarnessSubArtifactsEntity.artifactId,
					runId: agentHarnessSubArtifactsEntity.runId,
					kind: agentHarnessSubArtifactsEntity.kind,
					action: agentHarnessSubArtifactsEntity.action,
					appliedAt: agentHarnessSubArtifactsEntity.appliedAt,
					payload: agentHarnessSubArtifactsEntity.payload,
					createdAt: agentHarnessSubArtifactsEntity.createdAt,
				})
				.from(agentHarnessSubArtifactsEntity)
				.where(
					and(
						eq(agentHarnessSubArtifactsEntity.conversationId, conversationId),
						or(
							inArray(agentHarnessSubArtifactsEntity.id, clean),
							inArray(agentHarnessSubArtifactsEntity.artifactId, clean),
						),
					),
				)
				.limit(20);
		} catch (e) {
			logger.error("[DbService] Error getting sub-artifacts", { error: e });
			return [];
		}
	}

	async getAllCustomBlocks(
		projectId: string,
	): Promise<{ name: string; label: string; description: string }[]> {
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

	async getCustomBlockInputParams(
		projectId: string,
		name: string,
	): Promise<any[] | null> {
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
			logger.error("[DbService] Error getting custom block input params", {
				error: e,
			});
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
			logger.error("[DbService] Error getting custom blocks batch", {
				error: e,
			});
			return resultMap;
		}
	}
}
