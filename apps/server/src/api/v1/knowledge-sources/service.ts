import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../../../db";
import { CHAN_ON_KNOWLEDGE_SOURCE_CHANGE, publishMessage } from "../../../db/redis";
import { type KnowledgePage, knowledgeSourcesEntity } from "../../../db/schema";
import { ConflictError } from "../../../errors/conflictError";
import { NotFoundError } from "../../../errors/notFoundError";
import { audit, bodyFields } from "../../../modules/audit";
import type { bodySchema } from "./dto";
import { fetchMarkdown, ingest, parseLlmsLinks, resolveHeaders } from "./ingest";

type Body = z.infer<typeof bodySchema>;
type Row = typeof knowledgeSourcesEntity.$inferSelect;

const view = ({ pages, projectId: _p, createdAt: _c, updatedAt: _u, ...row }: Row) => ({
	...row,
	pageCount: (pages ?? []).length,
	editedCount: (pages ?? []).filter((p) => p.edited).length,
});

const byId = (projectId: string, id: string) =>
	and(eq(knowledgeSourcesEntity.projectId, projectId), eq(knowledgeSourcesEntity.id, id));

async function find(projectId: string, id: string) {
	const [row] = await db.select().from(knowledgeSourcesEntity).where(byId(projectId, id));
	if (!row) throw new NotFoundError("Knowledge source not found");
	return row;
}

/**
 * Fetch a source now. A failed fetch is saved as the source's status, keeping
 * the pages it had, so the UI shows the error instead of losing the source.
 */
async function fetched(projectId: string, s: Body & { pages?: KnowledgePage[] }) {
	try {
		const pages = await ingest(projectId, {
			...s,
			headers: s.headers ?? {},
			selectedPages: s.selectedPages ?? [],
		});
		const at = s.type === "markdown" ? null : new Date();
		return { pages, lastFetchedAt: at, lastFetchStatus: at && "ok", lastFetchError: null };
	} catch (e) {
		return {
			pages: s.pages ?? [],
			lastFetchedAt: new Date(),
			lastFetchStatus: "error",
			lastFetchError: e instanceof Error ? e.message : String(e),
		};
	}
}

const changed = (projectId: string) => publishMessage(CHAN_ON_KNOWLEDGE_SOURCE_CHANGE, projectId);

export async function list(projectId: string) {
	const rows = await db
		.select()
		.from(knowledgeSourcesEntity)
		.where(eq(knowledgeSourcesEntity.projectId, projectId))
		.orderBy(knowledgeSourcesEntity.name);
	return rows.map(view);
}

export async function get(projectId: string, id: string) {
	const row = await find(projectId, id);
	return { ...view(row), pages: row.pages };
}

async function nameTaken(projectId: string, name: string, id?: string) {
	const [row] = await db
		.select({ id: knowledgeSourcesEntity.id })
		.from(knowledgeSourcesEntity)
		.where(
			and(eq(knowledgeSourcesEntity.projectId, projectId), eq(knowledgeSourcesEntity.name, name)),
		);
	if (row && row.id !== id) throw new ConflictError(`A knowledge source named "${name}" exists`);
}

export async function create(projectId: string, body: Body) {
	await nameTaken(projectId, body.name);
	const { content: _, ...rest } = body;
	const [row] = await db
		.insert(knowledgeSourcesEntity)
		.values({ ...rest, projectId, ...(await fetched(projectId, body)) })
		.returning({ id: knowledgeSourcesEntity.id });
	await audit.record({
		projectId,
		resourceType: "knowledge_source",
		resourceId: row.id,
		action: "create",
		changedFields: bodyFields(body),
	});
	await changed(projectId);
	return { id: row.id };
}

/** What a fetch reads; a change to it means fetching again. */
const fetchInputs = (s: {
	type: string;
	url?: string | null;
	headers?: object;
	selectedPages?: string[];
}) => JSON.stringify([s.type, s.url ?? null, s.headers ?? {}, s.selectedPages ?? []]);

/** Replaces the source. It is fetched again only when what it fetches changed. */
export async function update(projectId: string, id: string, body: Body) {
	const old = await find(projectId, id);
	await nameTaken(projectId, body.name, id);
	const refetch = body.content !== undefined || fetchInputs(body) !== fetchInputs(old);
	const { content: _, ...rest } = body;
	await db
		.update(knowledgeSourcesEntity)
		.set({
			url: null,
			headers: {},
			selectedPages: [],
			...rest,
			...(refetch && (await fetched(projectId, { ...body, pages: old.pages }))),
		})
		.where(byId(projectId, id));
	await audit.record({
		projectId,
		resourceType: "knowledge_source",
		resourceId: id,
		action: "update",
		changedFields: bodyFields(body),
	});
	await changed(projectId);
	return { id };
}

export async function remove(projectId: string, id: string) {
	await find(projectId, id);
	await db.delete(knowledgeSourcesEntity).where(byId(projectId, id));
	await audit.record({
		projectId,
		resourceType: "knowledge_source",
		resourceId: id,
		action: "delete",
		changedFields: [],
	});
	await changed(projectId);
	return { id };
}

export async function refetch(projectId: string, id: string) {
	const old = await find(projectId, id);
	const body = {
		...old,
		url: old.url ?? undefined,
		content: old.type === "markdown" ? old.pages[0]?.markdown : undefined,
	};
	await db
		.update(knowledgeSourcesEntity)
		.set(await fetched(projectId, body))
		.where(byId(projectId, id));
	await audit.record({
		projectId,
		resourceType: "knowledge_source",
		resourceId: id,
		action: "update",
		changedFields: ["pages"],
	});
	await changed(projectId);
	return get(projectId, id);
}

/** The pages an llms.txt links to, for the user to pick from. */
export async function previewLlms(
	projectId: string,
	{ url, headers = {} }: { url: string; headers?: Record<string, string> },
) {
	const md = await fetchMarkdown(url, resolveHeaders(projectId, headers));
	return { pages: parseLlmsLinks(md, url) };
}

/** Updates a single page's markdown and marks it edited without refetching. */
export async function updatePage(
	projectId: string,
	id: string,
	indexParam: string | number,
	body: { markdown: string },
) {
	const old = await find(projectId, id);
	const idx = typeof indexParam === "number" ? indexParam : Number(indexParam);
	if (!Number.isInteger(idx) || idx < 0 || idx >= old.pages.length) {
		throw new NotFoundError("Page not found");
	}
	const pages = [...old.pages];
	pages[idx] = { ...pages[idx], markdown: body.markdown, edited: true };
	await db.update(knowledgeSourcesEntity).set({ pages }).where(byId(projectId, id));
	await audit.record({
		projectId,
		resourceType: "knowledge_source",
		resourceId: id,
		action: "update",
		changedFields: ["pages"],
	});
	await changed(projectId);
	return { id };
}
