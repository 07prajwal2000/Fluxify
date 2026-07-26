import {
	getConversationsByUserId,
	countConversationsByUserId,
	getLatestUserQueries,
	getStatusesByIds,
	type ConversationListFilters,
} from "./repository";
import { getCache, setCacheEx } from "@fluxify/server";
import { resolveRealtimeStatuses } from "../status";
import { getListCacheVersion } from "../cacheVersion";

const USER_QUERY_TRUNCATE_LEN = 50;

/** Truncates to a plain substring — no trailing "..."; the frontend decides
 *  how to indicate truncation. */
function truncateUserQuery(query?: string | null): string | undefined {
	if (!query) return undefined;
	return query.slice(0, USER_QUERY_TRUNCATE_LEN);
}

async function buildPage(
	userId: string,
	page: number,
	perPage: number,
	needUserQuery: boolean,
	filters: ConversationListFilters,
) {
	const offset = (page - 1) * perPage;
	const [conversations, totalCount] = await Promise.all([
		getConversationsByUserId(userId, perPage, offset, filters),
		countConversationsByUserId(userId, filters),
	]);

	let data: Array<(typeof conversations)[number] & { userQuery?: string }> =
		conversations;

	if (needUserQuery) {
		const queries = await getLatestUserQueries(conversations.map((c) => c.id));
		data = conversations.map((c) => ({
			...c,
			userQuery: truncateUserQuery(queries.get(c.id)),
		}));
	}

	const totalPages = Math.ceil(totalCount / perPage);
	return {
		data,
		pagination: { page, totalPages, hasNext: page < totalPages },
	};
}

/**
 * DB-derived fields (title, timestamps, truncated query) are cached, keyed by
 * a per-user version bumped on mutations (see `../cacheVersion.ts`) instead of
 * scanning-and-deleting matching keys. The archived/pinned filters are part of
 * the cache key too, since they select different rows entirely.
 *
 * `status` is never trusted from the cache: a cached row's status column can
 * be stale "running" long after a run actually finished, so it's refreshed
 * before the Redis realtime overlay runs (`../status.ts`) — but only with an
 * extra DB round trip on a cache *hit*. On a cache miss the page was just
 * built from the DB a moment ago, so its status is already current and the
 * refresh query is skipped.
 */
export default async function handleRequest(
	userId: string,
	page: number,
	perPage: number,
	needUserQuery: boolean,
	filters: ConversationListFilters,
) {
	const version = await getListCacheVersion(userId);
	const cacheKey = `harness-conversations:list:${userId}:${filters.projectId}:${version}:${page}:${perPage}:${needUserQuery}:${filters.archived}:${filters.pinned ?? "any"}:${filters.search ?? ""}`;
	const cached = await getCache(cacheKey);

	let base: Awaited<ReturnType<typeof buildPage>>;
	let freshStatuses: Map<string, string> | null = null;

	if (cached) {
		base = JSON.parse(cached);
		freshStatuses = await getStatusesByIds(base.data.map((c: any) => c.id));
	} else {
		base = await buildPage(userId, page, perPage, needUserQuery, filters);
		await setCacheEx(cacheKey, JSON.stringify(base), 60);
	}

	const realtimeStatuses = await resolveRealtimeStatuses(
		base.data.map((c: any) => ({
			id: c.id,
			status: freshStatuses?.get(c.id) ?? c.status,
		})),
	);

	const data = base.data.map((c: any) => ({
		...c,
		status: realtimeStatuses.get(c.id) ?? c.status,
	}));

	return { ...base, data };
}
