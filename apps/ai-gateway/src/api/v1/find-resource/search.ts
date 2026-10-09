import { logger } from "@fluxify/common";
import {
	appConfigEntity,
	customBlocksListEntity,
	db,
	integrationsEntity,
	routesEntity,
} from "@fluxify/server";
import { and, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { resultSchema } from "./dto";

export type FindResourceResult = z.infer<typeof resultSchema>;

/** A single search string or several keywords. */
export type SearchInput = string | string[];

/**
 * `"id"` looks the input up as an exact resource id, `"keyword"` full-text
 * searches names and descriptions.
 */
export type SearchMode = "keyword" | "id";

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

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

export class ResourceSearch {
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
	 * An id the agent itself issued is the one input FTS cannot resolve:
	 * `toPrefixTsQuery` turns a uuid into hex prefix terms and matches them
	 * against the *name* column. Agents hand ids around in text, so those lookups
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
			logger.error("[ResourceSearch] Error searching routes", { error: e });
			return [];
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
			logger.error("[ResourceSearch] Error searching app configs", { error: e });
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
				.where(and(eq(integrationsEntity.projectId, projectId), or(...matchers)))
				.limit(10);
			return integrations.map((i) => ({
				type: "integration",
				id: i.id,
				name: i.name || "",
				group: i.group || "",
				variant: i.variant || "",
			}));
		} catch (e) {
			logger.error("[ResourceSearch] Error searching integrations", { error: e });
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

			const matchers: SQL[] = this.idMatchers(customBlocksListEntity.id, keywords, mode);
			for (const k of mode === "id" ? [] : keywords) {
				matchers.push(ilike(customBlocksListEntity.name, `%${k}%`));
				matchers.push(ilike(customBlocksListEntity.label, `%${k}%`));
			}
			if (matchers.length === 0) return [];

			const customBlocks = await db
				.select({
					id: customBlocksListEntity.id,
					name: customBlocksListEntity.name,
					label: customBlocksListEntity.label,
					description: customBlocksListEntity.description,
					inputParams: customBlocksListEntity.inputParams,
				})
				.from(customBlocksListEntity)
				.where(
					and(
						or(
							eq(customBlocksListEntity.projectId, projectId),
							eq(customBlocksListEntity.sourceType, "inhouse"),
						),
						// test and middleware blocks (#534) can never sit on a canvas
						eq(customBlocksListEntity.usage, "flow"),
						or(...matchers),
					),
				)
				.limit(10);
			return customBlocks.map((c) => ({
				type: "custom_block",
				id: c.id,
				name: c.name,
				label: c.label || c.name,
				description: c.description || "",
				// the caller contract is the thing anyone looking a custom block
				// up actually needs; without it the id alone says nothing about
				// how to invoke the block
				inputParams: Array.isArray(c.inputParams) ? c.inputParams : [],
			}));
		} catch (e) {
			logger.error("[ResourceSearch] Error searching custom blocks", { error: e });
			return [];
		}
	}
}
