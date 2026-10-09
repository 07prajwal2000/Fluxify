// agent_messages (#645) against a real Postgres: seq order, the lock between
// writers, the summary view and resume all live in the database.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { migrateDB } from "@fluxify/server/src/db/migration";
import type { ModelMessage } from "ai";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { SUMMARY_HEAD } from "./compact";
import { json, scripted, step } from "./resume.fixture";
import { continueConversation } from "./resume";
import { type AgentStore, agentStore } from "./store";

const PG = { image: "postgres:16-alpine", name: "fluxify-agent-messages-pg-test" };
let container: Docker.Container | undefined;
let sql: SQL;
let store: AgentStore;

beforeAll(async () => {
	await docker.getContainer(PG.name).remove({ force: true }).catch(() => {});
	await pullImage(PG.image);
	const started = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: PG.image,
			name: PG.name,
			Env: ["POSTGRES_PASSWORD=postgres"],
			HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(host) }] } },
			ExposedPorts: { "5432/tcp": {} },
		}),
	);
	container = started.container;
	const url = `postgres://postgres:postgres@127.0.0.1:${started.port}/postgres`;
	for (let i = 0; ; i++) {
		const probe = new SQL(url, { max: 1 });
		try {
			await probe`SELECT 1`;
			break;
		} catch (error) {
			if (i >= 90) throw error;
			await Bun.sleep(500);
		} finally {
			await probe.close().catch(() => {});
		}
	}
	await migrateDB(url);
	sql = new SQL(url);
	store = agentStore(drizzle({ client: sql }));
}, 180_000);

afterAll(async () => {
	await sql?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

/** A fresh conversation with one run. */
async function conversation() {
	const id = crypto.randomUUID();
	await sql`INSERT INTO agent_harness_conversations (id) VALUES (${id})`;
	await sql`INSERT INTO agent_harness_runs (id, conversation_id, user_query) VALUES (${id}, ${id}, 'q')`;
	return id;
}
const runStatus = async (id: string) =>
	(await sql`SELECT status FROM agent_harness_runs WHERE id = ${id}`)[0].status;

describe("agent_messages", () => {
	it("stores messages as-is and loads them in seq order", async () => {
		const c = await conversation();
		const reasoning: ModelMessage = {
			role: "assistant",
			content: [
				{ type: "reasoning", text: "think", providerOptions: { anthropic: { signature: "sig" } } },
				{ type: "text", text: "hi" },
			],
		};
		expect(await store.append(c, c, [{ role: "user", content: "a" }, reasoning])).toEqual([0, 1]);
		expect(await store.append(c, c, step(1))).toEqual([2, 3]);
		const rows = await store.all(c);
		expect(rows.map((r) => [r.seq, r.role])).toEqual([
			[0, "user"],
			[1, "assistant"],
			[2, "assistant"],
			[3, "tool"],
		]);
		expect(rows[1].content).toEqual(reasoning);
		const [{ city }] = await sql`SELECT content->>'role' AS city FROM agent_messages WHERE seq = 1 AND conversation_id = ${c}`;
		expect(city).toBe("assistant"); // a real jsonb object, not a string
	});

	it("gives concurrent writers distinct, gapless seqs", async () => {
		const c = await conversation();
		await Promise.all(
			Array.from({ length: 20 }, (_, i) => store.append(c, c, [{ role: "user", content: `m${i}` }])),
		);
		expect((await store.all(c)).map((r) => r.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i));
	});

	it("pages the UI by seq: latest first, then beforeSeq, with a cursor until the start", async () => {
		const c = await conversation();
		await store.append(c, c, Array.from({ length: 7 }, (_, i) => ({ role: "user", content: `m${i}` })));
		const seqs = (p: { messages: { seq: number }[] }) => p.messages.map((r) => r.seq);
		const latest = await store.page(c, undefined, 3);
		expect([seqs(latest), latest.nextBeforeSeq]).toEqual([[4, 5, 6], 4]);
		const mid = await store.page(c, latest.nextBeforeSeq!, 3);
		expect([seqs(mid), mid.nextBeforeSeq]).toEqual([[1, 2, 3], 1]);
		const first = await store.page(c, mid.nextBeforeSeq!, 3);
		expect([seqs(first), first.nextBeforeSeq]).toEqual([[0], null]);
		expect(await store.page(c)).toMatchObject({ nextBeforeSeq: null }); // 7 rows fit one default page
	});

	it("a page never splits a tool call from its result", async () => {
		const c = await conversation();
		await store.append(c, c, [{ role: "user", content: "go" }, ...step(1), ...step(2)]); // 0 user, 1 call, 2 result, 3 call, 4 result
		// Limit 1 would start on the result at 4; it reaches back to the call at 3.
		const last = await store.page(c, undefined, 1);
		expect(last.messages.map((r) => r.seq)).toEqual([3, 4]);
		expect(last.nextBeforeSeq).toBe(3);
		// Limit 2 for the page before 3 starts on the result at 2; it takes the call at 1.
		const prev = await store.page(c, 3, 1);
		expect(prev.messages.map((r) => r.seq)).toEqual([1, 2]);
		expect(prev.nextBeforeSeq).toBe(1);
	});

	it("the model view is the latest summary and the rows after it; the UI still sees every row", async () => {
		const c = await conversation();
		await store.append(c, c, [{ role: "user", content: "build" }, ...step(1)]); // 0..2
		await store.appendSummary(c, c, { role: "user", content: `${SUMMARY_HEAD}one` }, 1); // 3
		await store.append(c, c, [{ role: "user", content: "next" }, ...step(2)]); // 4..6
		await store.appendSummary(c, c, { role: "user", content: `${SUMMARY_HEAD}two` }, 5); // 7
		const view = await store.modelView(c);
		expect(view.map((v) => [v.seq, v.message.role])).toEqual([
			[5, "user"], // summary two, at the seq it covers
			[4, "user"], // the covered user message, kept as compaction keeps it
			[6, "tool"],
		]);
		expect(view[0].message.content).toBe(`${SUMMARY_HEAD}two`);
		expect(await store.all(c)).toHaveLength(8);
	});

	it("a reload is exactly the history the run kept", async () => {
		const c = await conversation();
		const m = scripted([["get_route"], ["get_route"]], async () => ({ ok: true }));
		const r = await continueConversation({ store, conversationId: c, runId: c, agent: m.agent, message: "go" });
		expect(await r.status).toBe("completed");
		const view = await store.modelView(c);
		expect(view.map((v) => v.message)).toEqual(json((await store.all(c)).map((r) => r.content as ModelMessage)));
		expect(view.map((v) => v.message.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "assistant"]);
		expect(await runStatus(c)).toBe("completed");
	});

	it("a summary made during a run is a row, and the next turn starts from it", async () => {
		const c = await conversation();
		await store.append(c, c, [{ role: "user", content: "build" }, ...step(1), ...step(2)]);
		const m = scripted([], undefined, 1000);
		await (await continueConversation({ store, conversationId: c, runId: c, agent: m.agent, message: "test" })).status;
		const rows = await store.all(c);
		expect(rows.find((r) => r.role === "summary")?.coversUpToSeq).toBe(4);
		const view = await store.modelView(c);
		expect(view.map((v) => v.message.role)).toEqual(["user", "user", "assistant"]);
		expect(String(view[0].message.content)).toStartWith(SUMMARY_HEAD);
	});

	it("resumes after an approval wait, and never sends an assistant message last", async () => {
		const c = await conversation();
		const m = scripted([["save_route"]]);
		const first = await continueConversation({ store, conversationId: c, runId: c, agent: m.agent, message: "save" });
		expect(await first.status).toBe("waiting_approval");
		expect(await runStatus(c)).toBe("waiting_approval");
		expect(m.ran).toEqual([]);

		// a new process: everything comes from the database
		const next = await continueConversation({
			store,
			conversationId: c,
			runId: c,
			agent: m.agent,
			approval: { ok: true },
		});
		expect(await next.status).toBe("completed");
		expect(m.ran).toEqual(["save_route"]);
		expect(m.prompts[1].at(-1)?.role).toBe("tool");
		expect((await store.all(c)).map((r) => r.role)).toEqual(["user", "assistant", "tool", "assistant"]);
		expect(await runStatus(c)).toBe("completed");
	});
});
