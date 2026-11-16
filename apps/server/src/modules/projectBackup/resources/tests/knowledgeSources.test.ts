// Knowledge sources in a project backup (#1102), against a real Postgres and
// NATS. A backup carries the pages and tells the AI gateway to index the new
// project after the commit; a template drops the pages and fetches web sources
// again from their address. A failed index or fetch is a warning, never a
// failed restore.
import { afterAll, beforeAll, describe, expect, it, type Mock } from "bun:test";
import { join } from "node:path";
import { createStack, type Stack } from "../../../deployments/tests/blockHarness";
import { createBackup } from "../../backup";
import { BACKUP_MODULES } from "../../modules";
import { readBackup, restoreBackup } from "../../restore";

const FIXTURES = join(import.meta.dir, "..", "fixtures");
const CHANGE = "chan:on-knowledge-source-change";
/** refused even with loopback allowed: nothing listens on port 1 */
const DEAD = "http://127.0.0.1:1/gone.md";

let stack: Stack;
let db: any;
let schema: typeof import("../../../../db/schema");
let site: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
	stack = await createStack("backupknowledge");
	db = (await import("../../../../db")).db;
	schema = await import("../../../../db/schema");
	process.env.KNOWLEDGE_ALLOW_PRIVATE_URLS = "true";
	site = Bun.serve({ port: 0, fetch: () => new Response("# Live\n\nfetched again") });
}, 240_000);

afterAll(async () => {
	delete process.env.KNOWLEDGE_ALLOW_PRIVATE_URLS;
	site?.stop(true);
	await stack?.stop();
});

type Mode = "backup" | "template";

async function sourceProject(urls = { live: `http://127.0.0.1:${site.port}/doc.md`, dead: DEAD }) {
	const project = Bun.randomUUIDv7();
	await db.insert(schema.projectsEntity).values({ id: project, name: project, slug: project });
	await db.insert(schema.knowledgeSourcesEntity).values([
		{
			projectId: project,
			name: "handbook",
			type: "markdown",
			pages: [{ markdown: "# Handbook\n\nprivate notes", edited: true }],
		},
		{
			projectId: project,
			name: "vendor",
			type: "url",
			url: urls.live,
			headers: { Authorization: "DOCS_TOKEN" },
			pages: [{ url: urls.live, markdown: "# Vendor\n\nstored copy" }],
			lastFetchedAt: new Date("2026-11-01T00:00:00Z"),
			lastFetchStatus: "ok",
		},
		{
			projectId: project,
			name: "public",
			type: "url",
			url: urls.live,
			pages: [{ url: urls.live, markdown: "# Public\n\nold copy" }],
		},
		{ projectId: project, name: "broken", type: "url", url: urls.dead, enabled: false },
	]);
	return project;
}

const backup = async (projectId: string, mode: Mode = "backup", sections?: string[]) =>
	(
		await createBackup(
			{ projectId, source: { name: "src", slug: "src" }, mode, sections, options: { includeVersionHistory: false } },
			BACKUP_MODULES,
		)
	).bytes;

const restore = async (bytes: Uint8Array) =>
	restoreBackup(await readBackup(bytes, BACKUP_MODULES), (work) =>
		db.transaction(async (tx: any) => {
			const id = Bun.randomUUIDv7();
			await tx.insert(schema.projectsEntity).values({ id, name: id, slug: id });
			await work(tx, id);
			return id;
		}),
	);

const sources = async (projectId: string) => {
	const { eq } = await import("drizzle-orm");
	const t = schema.knowledgeSourcesEntity;
	const rows = await db.select().from(t).where(eq(t.projectId, projectId));
	return new Map<string, any>(rows.map((r: any) => [r.name, r]));
};

const indexed = (projectId: string) => stack.signals.filter((s) => s.chan === CHANGE && s.id === projectId);

describe("knowledge sources backup", () => {
	it("restores every source with its pages and indexes the new project, not the source", async () => {
		const src = await sourceProject();
		const before = await sources(src);
		const { projectId, warnings } = await restore(await backup(src));
		expect(warnings).toEqual([]);

		const rows = await sources(projectId);
		expect([...rows.keys()].sort()).toEqual(["broken", "handbook", "public", "vendor"]);
		for (const [name, row] of rows) {
			const old = before.get(name);
			expect(row.id).not.toBe(old.id);
			for (const k of ["type", "url", "headers", "selectedPages", "pages", "enabled", "lastFetchedAt", "lastFetchStatus"])
				expect([name, k, row[k]]).toEqual([name, k, old[k]]);
		}
		// no refetch in a backup: the stored (edited) copy is what the agent searches
		expect(rows.get("public").pages[0].markdown).toContain("old copy");
		expect(indexed(projectId)).toHaveLength(1);
		expect(await sources(src)).toEqual(before);
	});

	it("restores the rows and warns when the gateway can't be told to index", async () => {
		const src = await sourceProject();
		// the harness already records publishes; fail only the index signal, then put it back
		const publish = (await import("../../../../db/pubsub")).publishMessage as unknown as Mock<any>;
		const record = publish.getMockImplementation()!;
		publish.mockImplementation(async (chan: string, id: unknown) => {
			if (chan === CHANGE) throw new Error("NATS down");
			return record(chan, id);
		});
		try {
			const { projectId, warnings } = await restore(await backup(src));
			expect(warnings).toEqual([
				{
					section: "knowledgeSources",
					message: expect.stringContaining(`The agent can't search the restored knowledge base yet ("broken", "handbook", "public", "vendor")`),
				},
			]);
			expect((await sources(projectId)).get("handbook").pages).toHaveLength(1);
		} finally {
			publish.mockImplementation(record);
		}
	});

	it("leaves the documents out of a template, fetches web sources again, and warns", async () => {
		const src = await sourceProject();
		const bytes = await backup(src, "template");
		const plan = await readBackup(bytes, BACKUP_MODULES);
		const section = plan.sections.find((s) => s.module.name === "knowledgeSources")!.data as any;
		expect(JSON.stringify(section)).not.toContain("private notes");
		expect(JSON.stringify(section)).not.toContain("stored copy");
		expect(plan.warnings).toEqual([
			{ section: "knowledgeSources", message: `Knowledge source "handbook" has no documents; upload them to use it.` },
		]);

		const { projectId, warnings } = await restore(bytes);
		expect(warnings.map((w) => w.message)).toEqual([
			`Knowledge source "handbook" has no documents; upload them to use it.`,
			`Knowledge source "broken" could not be indexed. Open it and press Refetch.`,
			// its header's app config key has no value in a template
			`Knowledge source "vendor" could not be indexed. Open it and press Refetch.`,
		]);
		const rows = await sources(projectId);
		expect(rows.get("handbook").pages).toEqual([]);
		expect(rows.get("public")).toMatchObject({ lastFetchStatus: "ok", pages: [{ markdown: "# Live\n\nfetched again" }] });
		expect(rows.get("vendor")).toMatchObject({ pages: [], lastFetchStatus: "error", headers: { Authorization: "DOCS_TOKEN" } });
		expect(rows.get("broken")).toMatchObject({ pages: [], lastFetchStatus: "error", enabled: false });
		// indexed once, after the refetches
		expect(indexed(projectId)).toHaveLength(1);
	});

	it("restores no sources and no warnings when the section is left out", async () => {
		const src = await sourceProject();
		const all = BACKUP_MODULES.map((m) => m.name).filter((n) => n !== "knowledgeSources");
		const { projectId, warnings } = await restore(await backup(src, "backup", all));
		expect(warnings).toEqual([]);
		expect((await sources(projectId)).size).toBe(0);
	});

	it("restores the committed v1 fixture", async () => {
		const file = Bun.file(join(FIXTURES, "knowledge-sources-v1.tar.gz"));
		if (process.env.WRITE_BACKUP_FIXTURES && !(await file.exists())) {
			const src = await sourceProject({ live: DEAD, dead: DEAD });
			await Bun.write(file, await backup(src, "template", ["knowledgeSources"]));
		}
		// a fresh handle: the one above may have cached the file as missing
		const { projectId, warnings } = await restore(await Bun.file(file.name!).bytes());
		const rows = await sources(projectId);
		expect([...rows.keys()].sort()).toEqual(["broken", "handbook", "public", "vendor"]);
		expect(rows.get("vendor")).toMatchObject({ type: "url", url: DEAD, headers: { Authorization: "DOCS_TOKEN" } });
		expect(warnings.map((w) => w.message)).toContain(`Knowledge source "handbook" has no documents; upload them to use it.`);
	});
});
