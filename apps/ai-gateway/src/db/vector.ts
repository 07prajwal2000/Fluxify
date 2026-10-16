import { logger } from "@fluxify/common";
import type { AnyOrama } from "@orama/orama";
import { count, create, insertMultiple, search } from "@orama/orama";
import { restoreFromFile } from "@orama/plugin-data-persistence/server";
import { DOCS_INDEX_PATH } from "../constants";
import { extractFrontmatter } from "../lib/frontmatter";

/** One `##` section of a docs page. `###` and below stay inside it. */
export type DocSection = {
	id: string;
	/** Path under docs/ without `.md`, e.g. `concepts/triggers`, `agents/index` */
	page: string;
	title: string;
	description: string;
	/** `INTRO` for the text before the first `##` */
	heading: string;
	/** 1 for the intro, 2 for a `##` section */
	level: number;
	/** Position in the page, to rebuild it in order */
	order: number;
	/** Under docs/agents/: written for agents, ranks first */
	agent: boolean;
	text: string;
};

export const INTRO = "(intro)";

const SCHEMA = {
	page: "string",
	title: "string",
	description: "string",
	heading: "string",
	level: "number",
	order: "number",
	agent: "boolean",
	text: "string",
} as const;

/**
 * An agent-page hit scoring at least this share of the best hit goes ahead of
 * every human-page hit. ponytail: fixed cut-off, tune it if weak agent hits
 * start crowding out the right human page.
 */
const AGENT_MIN_SHARE = 1 / 3;

/**
 * Split a page into its intro and one section per `##` heading. `## ` lines
 * inside code fences are code, not headings. A page with no frontmatter title
 * is skipped (null), as before.
 */
export function chunkPage(page: string, raw: string): DocSection[] | null {
	const fm = extractFrontmatter(raw);
	if (!fm.title) return null;
	const body = raw.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n?/, "");
	const parts = [{ heading: INTRO, lines: [] as string[] }];
	let fenced = false;
	for (const line of body.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
		const h2 = fenced ? null : line.match(/^##\s+(.+)$/);
		if (h2) parts.push({ heading: cleanHeading(h2[1]), lines: [] });
		// the h1 repeats the title
		else if (parts.length > 1 || !/^#\s/.test(line)) parts.at(-1)!.lines.push(line);
	}
	return parts
		.map((p, order) => ({
			id: `${page}#${order}`,
			page,
			title: String(fm.title),
			description: String(fm.description ?? ""),
			heading: p.heading,
			level: order === 0 ? 1 : 2,
			order,
			agent: page.startsWith("agents/"),
			text: p.lines.join("\n").trim(),
		}))
		.filter((s) => s.text || s.level === 2);
}

/** `Foo {#foo}` / `Foo <Badge text="EE" />` → `Foo` */
const cleanHeading = (h: string) =>
	h
		.replace(/\{#[^}]*\}/g, "")
		.replace(/<[^>]+>/g, "")
		.replace(/\s+#+\s*$/, "")
		.trim();

export function buildDocsDB(sections: DocSection[]) {
	const db = create({ schema: SCHEMA });
	insertMultiple(db, sections);
	return db;
}

let docsDB: AnyOrama | undefined;
let allCache: DocSection[] | undefined;
let docsReady: Promise<void> | undefined;

/** Swap the index in (tests use a small in-memory one). */
export function setDocsDB(db: AnyOrama) {
	docsDB = db;
	allCache = undefined;
}

export async function initDocsDB() {
	setDocsDB(await restoreFromFile("binary", DOCS_INDEX_PATH));
	logger.info(`Initialized docs index: ${DOCS_INDEX_PATH}`, "DocsDB");
}

/** Load the index once, on first use. Throws when it was never built. */
export async function ensureDocsDB() {
	if (docsDB) return;
	try {
		docsReady ??= initDocsDB();
		await docsReady;
	} catch (e) {
		docsReady = undefined;
		throw e;
	}
}

/** One Orama index per project's custom knowledge base (#800), built from stored Markdown. */
const kbDBs = new Map<string, AnyOrama>();

/** A source's stored page as a docs page; one without a frontmatter title gets one. */
export function kbPageSections(
	source: string,
	pages: { url?: string; markdown: string }[],
): DocSection[] {
	const seen = new Set<string>();
	return pages.flatMap((p, i) => {
		const slug = p.url ? new URL(p.url).pathname.replace(/^\/+|\/+$|\.(md|html?)$/g, "") : "";
		let path = `kb/${source}/${slug || (pages.length > 1 ? String(i + 1) : "index")}`;
		if (seen.has(path)) path += `-${i + 1}`;
		seen.add(path);
		const title = (p.markdown.match(/^#\s+(.+)$/m)?.[1] ?? p.url ?? source).trim();
		const raw = extractFrontmatter(p.markdown).title
			? p.markdown
			: `---\ntitle: ${title}\n---\n\n${p.markdown}`;
		return chunkPage(path, raw) ?? [];
	});
}

/** Replace a project's knowledge base index; no sections drops it. */
export function setProjectKB(projectId: string, sections: DocSection[]) {
	if (sections.length) kbDBs.set(projectId, buildDocsDB(sections));
	else kbDBs.delete(projectId);
}

/**
 * Best matching sections, relevant agent-page sections first. With a project,
 * its knowledge base hits merge in by score, no boost.
 */
export async function searchSections(
	query: string,
	limit = 4,
	projectId?: string,
): Promise<DocSection[]> {
	const kb = projectId ? kbDBs.get(projectId) : undefined;
	const hits = (
		await Promise.all(
			[docsDB!, ...(kb ? [kb] : [])].map((db) =>
				search(db, {
					term: query,
					properties: ["title", "heading", "text"],
					boost: { heading: 2 },
					limit: limit * 3,
				}),
			),
		)
	)
		.flatMap((r) => r.hits)
		.sort((a, b) => b.score - a.score);
	const cutoff = (hits[0]?.score ?? 0) * AGENT_MIN_SHARE;
	const first = (h: (typeof hits)[number]) => (h.document as DocSection).agent && h.score >= cutoff;
	// hits come sorted by score, and a stable sort keeps that order inside each group
	return hits
		.toSorted((a, b) => Number(first(b)) - Number(first(a)))
		.slice(0, limit)
		.map((h) => h.document as DocSection);
}

const everySection = async (db: AnyOrama) =>
	(await search(db, { term: "", limit: count(db) })).hits
		.map((h) => h.document as DocSection)
		.sort((a, b) => a.page.localeCompare(b.page) || a.order - b.order);

/** Every section in the index, in page order, then the project's knowledge base. */
export async function allSections(projectId?: string): Promise<DocSection[]> {
	allCache ??= await everySection(docsDB!);
	const kb = projectId ? kbDBs.get(projectId) : undefined;
	return kb ? [...allCache, ...(await everySection(kb))] : allCache;
}
