import { beforeAll, describe, expect, it } from "bun:test";
import { buildDocsDB, chunkPage, getDocsByTitle, INTRO, setDocsDB } from "../../db/vector";
import { docsTools } from "../docsTools";

const page = (title: string, body: string) =>
	`---\ntitle: ${title}\ndescription: About ${title}\n---\n\n# ${title}\n\n${body}`;

const TRIGGERS = page(
	"Triggers",
	[
		"A trigger starts a workflow.",
		"## Cron triggers",
		"Run a workflow on a cron schedule.",
		"### Syntax",
		"Five fields.",
		"```bash",
		"## not a heading",
		"```",
		"## Queue triggers {#queue}",
		"Read messages from a queue.",
	].join("\n"),
);
const AGENT_TRIGGERS = page("Trigger reference", "## Fields\n\nA cron trigger has a schedule field.");

const tool = (name: string) => docsTools.find((t) => t.name === name)!;
const call = (name: string, args: object) => tool(name).call({} as never, args) as Promise<string>;

describe("chunkPage", () => {
	const secs = chunkPage("concepts/triggers", TRIGGERS)!;

	it("splits on ## only, keeps ### and fenced ## inside, and drops the h1", () => {
		expect(secs.map((s) => [s.heading, s.level])).toEqual([
			[INTRO, 1],
			["Cron triggers", 2],
			["Queue triggers", 2],
		]);
		expect(secs[0].text).toBe("A trigger starts a workflow.");
		expect(secs[1].text).toContain("### Syntax");
		expect(secs[1].text).toContain("## not a heading");
		expect(secs[1]).toMatchObject({ page: "concepts/triggers", title: "Triggers", agent: false });
	});

	it("marks agent pages and skips pages without a title", () => {
		expect(chunkPage("agents/triggers", AGENT_TRIGGERS)!.every((s) => s.agent)).toBe(true);
		expect(chunkPage("x", "# No frontmatter")).toBeNull();
	});

	it("leaves out an empty intro", () => {
		expect(chunkPage("agents/triggers", AGENT_TRIGGERS)!.map((s) => s.heading)).toEqual(["Fields"]);
	});
});

describe("docs tools", () => {
	beforeAll(() => {
		setDocsDB(
			buildDocsDB([
				...chunkPage("concepts/triggers", TRIGGERS)!,
				...chunkPage("agents/triggers", AGENT_TRIGGERS)!,
				...chunkPage("concepts/routes", page("Routes", "## Paths\n\nRoutes have paths."))!,
			]),
		);
	});

	it("are viewer-only reads", () => {
		for (const t of docsTools) expect([t.role, t.annotations]).toEqual(["viewer", undefined]);
	});

	it("search_docs returns sections, deduped, with the agent page first", async () => {
		const out = await call("search_docs", { queries: ["cron trigger", "cron trigger"] });
		const headers = out.match(/^\[page: .*\]$/gm)!;
		expect(headers[0]).toBe("[page: agents/triggers | Trigger reference > Fields]");
		expect(headers).toContain("[page: concepts/triggers | Triggers > Cron triggers]");
		expect(new Set(headers).size).toBe(headers.length);
		expect(out).not.toContain("concepts/routes");
	});

	it("read_doc with no heading gives the outline", async () => {
		expect(await call("read_doc", { page: "/concepts/triggers.md" })).toBe(
			`# Triggers (page: concepts/triggers)\nAbout Triggers\n\nSections (pass one as heading):\n- ${INTRO}\n- Cron triggers\n- Queue triggers`,
		);
	});

	it("read_doc with a heading gives only that section, by title too", async () => {
		const out = await call("read_doc", { page: "Triggers", heading: "## queue triggers" });
		expect(out).toBe("[page: concepts/triggers | Triggers > Queue triggers]\n\nRead messages from a queue.");
	});

	it("read_doc names close pages and the real headings when one is unknown", async () => {
		expect(await call("read_doc", { page: "trigger" })).toBe(
			'Unknown docs page "trigger". Close matches: agents/triggers, concepts/triggers.',
		);
		expect(await call("read_doc", { page: "concepts/triggers", heading: "Webhooks" })).toBe(
			`No heading "Webhooks" on concepts/triggers. Headings: ${INTRO} | Cron triggers | Queue triggers`,
		);
	});

	it("rebuilds a whole page by title for the old harness", async () => {
		const [doc] = await getDocsByTitle(["routes"]);
		expect(doc.content).toBe("# Routes\n\n## Paths\n\nRoutes have paths.");
	});
});
