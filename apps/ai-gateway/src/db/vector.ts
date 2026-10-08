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

/** Best matching sections, relevant agent-page sections first. */
export async function searchSections(query: string, limit = 4): Promise<DocSection[]> {
	const { hits } = await search(docsDB!, {
		term: query,
		properties: ["title", "heading", "text"],
		boost: { heading: 2 },
		limit: limit * 3,
	});
	const cutoff = (hits[0]?.score ?? 0) * AGENT_MIN_SHARE;
	const first = (h: (typeof hits)[number]) => (h.document as DocSection).agent && h.score >= cutoff;
	// hits come sorted by score, and a stable sort keeps that order inside each group
	return hits
		.toSorted((a, b) => Number(first(b)) - Number(first(a)))
		.slice(0, limit)
		.map((h) => h.document as DocSection);
}

/** Every section in the index, in page order. */
export async function allSections(): Promise<DocSection[]> {
	if (!allCache) {
		const res = await search(docsDB!, { term: "", limit: count(docsDB!) });
		allCache = res.hits
			.map((h) => h.document as DocSection)
			.sort((a, b) => a.page.localeCompare(b.page) || a.order - b.order);
	}
	return allCache;
}

type Document = { id: string; title: string; description: string; content: string };

const asText = (s: DocSection) => (s.heading === INTRO ? s.text : `## ${s.heading}\n\n${s.text}`);

/** Old harness only (#648 deletes it): sections shaped as its whole-page documents. */
export async function queryDocs(query: string, limit: number = 5): Promise<Document[]> {
	return (await searchSections(query, limit)).map((s) => ({
		id: s.id,
		title: s.title,
		description: s.description,
		content: `# ${s.title}\n\n${asText(s)}`,
	}));
}

/**
 * Whole pages by their exact frontmatter title, rebuilt from their sections.
 * Old harness only: it pre-loads a few pages into a prompt.
 */
export async function getDocsByTitle(titles: string[]): Promise<Document[]> {
	const all = await allSections();
	return titles.flatMap((title) => {
		const secs = all.filter((s) => s.title.toLowerCase() === title.toLowerCase());
		if (!secs.length) return [];
		const page = secs.filter((s) => s.page === secs[0].page);
		const content = `# ${page[0].title}\n\n${page.map(asText).join("\n\n")}`;
		return [{ id: page[0].page, title: page[0].title, description: page[0].description, content }];
	});
}
