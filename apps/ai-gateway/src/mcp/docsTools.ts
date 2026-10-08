import { z } from "zod";
import { allSections, type DocSection, ensureDocsDB, INTRO, searchSections } from "../db/vector";
import type { McpTool } from "./tools";

const NOT_BUILT = "The docs index is not built here (bun run --cwd apps/ai-gateway gather).";
/** ponytail: flat cap on one section; a section that long should be split in the docs. */
const MAX_SECTION_CHARS = 12_000;
const HITS_PER_QUERY = 4;

const capped = (text: string) =>
	text.length <= MAX_SECTION_CHARS
		? text
		: `${text.slice(0, MAX_SECTION_CHARS)}\n\n(section cut at ${MAX_SECTION_CHARS} characters)`;

const render = (s: DocSection) =>
	`[page: ${s.page} | ${s.title} > ${s.heading}]\n\n${capped(s.text)}`;

/** `/agents/`, `concepts/triggers.md`, `Triggers` → the same lookup key */
const norm = (p: string) =>
	p
		.trim()
		.toLowerCase()
		.replace(/^\/+/, "")
		.replace(/\.md$/, "")
		.replace(/(^|\/)$/, "$1index");

async function searchDocs(queries: string[]) {
	const seen = new Set<string>();
	const hits = (await Promise.all(queries.map((q) => searchSections(q, HITS_PER_QUERY))))
		.flat()
		.filter((s) => !seen.has(s.id) && seen.add(s.id));
	if (!hits.length) return "No docs matched. Try other words.";
	return `${hits.map(render).join("\n\n---\n\n")}\n\n(read_doc with a page shows its other sections)`;
}

async function readDoc(page: string, heading?: string) {
	const all = await allSections();
	const key = norm(page);
	const secs = all.filter((s) => s.page.toLowerCase() === key || s.title.toLowerCase() === key);
	if (!secs.length) {
		const word = key.split("/").at(-1)!;
		const close = [...new Set(all.filter((s) => s.page.includes(word)).map((s) => s.page))];
		const pages = close.length
			? close
			: [...new Set((await searchSections(page, 10)).map((s) => s.page))];
		return `Unknown docs page "${page}". Close matches: ${pages.slice(0, 5).join(", ") || "none"}.`;
	}
	const own = secs.filter((s) => s.page === secs[0].page);
	const headings = own.map((s) => s.heading);
	if (!heading) {
		const { page: p, title, description } = own[0];
		return `# ${title} (page: ${p})\n${description}\n\nSections (pass one as heading):\n${headings.map((h) => `- ${h}`).join("\n")}`;
	}
	const h = heading
		.trim()
		.replace(/^#+\s*/, "")
		.toLowerCase();
	const hit =
		own.find((s) => s.heading.toLowerCase() === h) ??
		own.find((s) => s.heading.toLowerCase().includes(h));
	return hit
		? render(hit)
		: `No heading "${heading}" on ${own[0].page}. Headings: ${headings.join(" | ")}`;
}

/** Docs need the bundled index; a missing one is an answer, not an error. */
const withIndex =
	<A>(fn: (a: A) => Promise<string>) =>
	async (_api: unknown, a: A) => {
		try {
			await ensureDocsDB();
		} catch {
			return NOT_BUILT;
		}
		return fn(a);
	};

/** The Fluxify docs, from the index bundled at build time. Reads no project data. */
export const docsTools: McpTool[] = [
	{
		name: "search_docs",
		description:
			"Search the Fluxify docs. Returns the matching sections (page, heading, text). Pass every topic you need in one call.",
		role: "viewer",
		input: { queries: z.array(z.string()).min(1).max(5).describe("One entry per topic") },
		call: withIndex(({ queries }: { queries: string[] }) => searchDocs(queries)),
	},
	{
		name: "read_doc",
		description: `Read one docs page. No heading: its title, description and section headings. With a heading: that section's text (the intro is "${INTRO}").`,
		role: "viewer",
		input: {
			page: z.string().describe("Page path from search_docs (e.g. concepts/triggers) or its title"),
			heading: z.string().optional().describe("A heading from the outline"),
		},
		call: withIndex(({ page, heading }: { page: string; heading?: string }) =>
			readDoc(page, heading),
		),
	},
];
