import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { ingest } from "../../../api/v1/knowledge-sources/ingest";
import { db } from "../../../db";
import { CHAN_ON_KNOWLEDGE_SOURCE_CHANGE, publishMessage } from "../../../db/redis";
import { KNOWLEDGE_SOURCE_TYPES, knowledgeSourcesEntity } from "../../../db/schema";
import type { BackupModule } from "../types";

/**
 * A project's knowledge base sources (#1102), content included.
 *
 * There are no embeddings to leave out: a source's pages are Markdown in
 * Postgres, and the AI gateway builds an in-memory full-text index from them
 * whenever it hears `CHAN_ON_KNOWLEDGE_SOURCE_CHANGE` for the project. So a
 * **backup** carries the pages as stored (user edits and all, no dependency on
 * the site still being up), and the restore only tells the gateway to rebuild,
 * after the commit.
 *
 * A **template** is plain and readable by anyone, and pages can be private (an
 * uploaded document, or a page fetched with an auth header). It keeps every
 * source's definition (type, address, header → app config key names, picked
 * pages) and drops the pages. A web source is fetched again from its address
 * after the commit; a Markdown source stays empty until someone uploads it.
 *
 * Nothing points at a knowledge source by id: the agent searches every enabled
 * source of its project. The name → id map is filled for completeness.
 */

const pageSchema = z.object({
	url: z.string().optional(),
	markdown: z.string(),
	edited: z.boolean().optional(),
});

const sourceSchema = z.object({
	name: z.string().min(1).max(100),
	type: z.enum(KNOWLEDGE_SOURCE_TYPES),
	url: z.string().nullable().default(null),
	headers: z.record(z.string(), z.string()).default({}),
	selectedPages: z.array(z.string()).default([]),
	pages: z.array(pageSchema).default([]),
	enabled: z.boolean().default(true),
	lastFetchedAt: z.coerce.date().nullable().default(null),
	lastFetchStatus: z.string().max(10).nullable().default(null),
	lastFetchError: z.string().nullable().default(null),
});

const schema = z.object({ sources: z.array(sourceSchema) });
type Section = z.infer<typeof schema>;
type Source = Section["sources"][number];

const forTemplate = (s: Source): Source => ({
	...s,
	pages: [],
	lastFetchedAt: null,
	lastFetchStatus: null,
	lastFetchError: null,
});

const reindexWarning = (name: string) =>
	`Knowledge source "${name}" could not be indexed. Open it and press Refetch.`;

/** fetch a web source from its address, as a save does; a failure is kept on the row too */
async function refetch(projectId: string, id: string, s: Source) {
	const byId = eq(knowledgeSourcesEntity.id, id);
	try {
		const pages = await ingest(projectId, s);
		await db
			.update(knowledgeSourcesEntity)
			.set({ pages, lastFetchedAt: new Date(), lastFetchStatus: "ok", lastFetchError: null })
			.where(byId);
	} catch (e) {
		const lastFetchError = e instanceof Error ? e.message : String(e);
		await db
			.update(knowledgeSourcesEntity)
			.set({ lastFetchedAt: new Date(), lastFetchStatus: "error", lastFetchError })
			.where(byId);
		throw e;
	}
}

export const knowledgeSourcesModule: BackupModule<Section> = {
	name: "knowledgeSources",
	version: 1,
	minSupported: 1,
	upgrades: {},
	dependsOn: [],
	schema,

	inspect: ({ sources }) =>
		sources
			.filter((s) => s.type === "markdown" && !s.pages.length)
			.map((s) => `Knowledge source "${s.name}" has no documents; upload them to use it.`),

	async export({ projectId, mode }) {
		const rows = await db
			.select()
			.from(knowledgeSourcesEntity)
			.where(eq(knowledgeSourcesEntity.projectId, projectId))
			.orderBy(asc(knowledgeSourcesEntity.name));
		const sources: Source[] = rows.map((r) => ({
			name: r.name,
			type: r.type,
			url: r.url,
			headers: r.headers,
			selectedPages: r.selectedPages,
			pages: r.pages,
			enabled: r.enabled,
			lastFetchedAt: r.lastFetchedAt,
			lastFetchStatus: r.lastFetchStatus,
			lastFetchError: r.lastFetchError,
		}));
		return { data: { sources: mode === "template" ? sources.map(forTemplate) : sources } };
	},

	async import({ tx, projectId, mode, ids, afterCommit }, { sources }) {
		for (const s of sources) {
			const [row] = await tx
				.insert(knowledgeSourcesEntity)
				.values({ ...s, projectId })
				.returning({ id: knowledgeSourcesEntity.id });
			ids.set("knowledgeSources", s.name, row!.id);
			if (mode === "template" && s.type !== "markdown")
				afterCommit(() => refetch(projectId, row!.id, s), reindexWarning(s.name));
		}
		// last, so the gateway indexes the refetched pages too
		if (sources.length)
			afterCommit(
				() => publishMessage(CHAN_ON_KNOWLEDGE_SOURCE_CHANGE, projectId).then(() => {}),
				`The agent can't search the restored knowledge base yet (${sources.map((s) => `"${s.name}"`).join(", ")}). Open a source and save it, or restart the AI gateway.`,
			);
	},
};
