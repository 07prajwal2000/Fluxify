import {
	agentConversationsEntity as conversations,
	agentMessagesEntity as messages,
	agentRunsEntity as runs,
} from "@fluxify/server/src/db/agent-schema";
import type { ModelMessage } from "ai";
import { and, asc, desc, eq, gt, lt, lte, max, ne } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

export type RunStatus = (typeof runs.$inferSelect)["status"];
/** A message of the model view and the seq it maps to (a summary maps to the seq it covers up to). */
export type Seqd = { message: ModelMessage; seq: number };

/** Rows per page of the chat UI. */
export const PAGE_SIZE = 50;

/**
 * agent_messages (#645): one row per finished message, never edited or
 * deleted. The UI reads every row; the model reads `modelView`.
 */
export function agentStore(db: BunSQLDatabase) {
	/** Appends rows after the conversation's last seq. Locking the conversation row keeps two writers from taking the same seq. */
	const insert = (
		conversationId: string,
		runId: string,
		rows: {
			role: (typeof messages.$inferInsert)["role"];
			content: object;
			coversUpToSeq?: number;
		}[],
	) =>
		db.transaction(async (tx) => {
			await tx
				.select({ id: conversations.id })
				.from(conversations)
				.where(eq(conversations.id, conversationId))
				.for("update");
			const [{ last }] = await tx
				.select({ last: max(messages.seq) })
				.from(messages)
				.where(eq(messages.conversationId, conversationId));
			const start = (last ?? -1) + 1;
			const values = rows.map((r, i) => ({ ...r, conversationId, runId, seq: start + i }));
			await tx.insert(messages).values(values);
			return values.map((v) => v.seq);
		});

	return {
		/** Stores finished messages in order; returns their seqs. */
		append: (conversationId: string, runId: string, list: ModelMessage[]) =>
			list.length
				? insert(
						conversationId,
						runId,
						list.map((m) => ({ role: m.role as "user", content: m })),
					)
				: Promise.resolve([]),

		/** Stores a summary standing in for every row up to `coversUpToSeq`. */
		appendSummary: async (
			conversationId: string,
			runId: string,
			summary: ModelMessage,
			coversUpToSeq: number,
		) =>
			(
				await insert(conversationId, runId, [{ role: "summary", content: summary, coversUpToSeq }])
			)[0],

		/** Every row, in order (the UI). */
		all: (conversationId: string) =>
			db
				.select()
				.from(messages)
				.where(eq(messages.conversationId, conversationId))
				.orderBy(asc(messages.seq)),

		/**
		 * One page for the UI: the latest `limit` rows, or the `limit` before `beforeSeq`,
		 * in order. A page never starts on a tool result: it reaches back to the call's
		 * row so the two stay together. `nextBeforeSeq` is the cursor for the next older
		 * page, null when there is none.
		 */
		page: async (conversationId: string, beforeSeq?: number, limit = PAGE_SIZE) => {
			const of = eq(messages.conversationId, conversationId);
			const older = (seq: number, n: number) =>
				db
					.select()
					.from(messages)
					.where(and(of, lt(messages.seq, seq)))
					.orderBy(desc(messages.seq))
					.limit(n);
			const rows =
				beforeSeq === undefined
					? await db.select().from(messages).where(of).orderBy(desc(messages.seq)).limit(limit)
					: await older(beforeSeq, limit);
			while (rows.at(-1)?.role === "tool") {
				const [prev] = await older(rows.at(-1)!.seq, 1);
				if (!prev) break;
				rows.push(prev);
			}
			const oldest = rows.at(-1);
			const [more] = oldest ? await older(oldest.seq, 1) : [];
			return { messages: rows.reverse(), nextBeforeSeq: more ? oldest!.seq : null };
		},

		/**
		 * What the model gets: the latest summary, then the rows after what it
		 * covers. When none of those is a user message, the last user message it
		 * covers comes right after it, as compaction keeps it in memory.
		 */
		modelView: async (conversationId: string): Promise<Seqd[]> => {
			const of = eq(messages.conversationId, conversationId);
			const [summary] = await db
				.select()
				.from(messages)
				.where(and(of, eq(messages.role, "summary")))
				.orderBy(desc(messages.seq))
				.limit(1);
			const covers = summary?.coversUpToSeq ?? -1;
			const rest = await db
				.select()
				.from(messages)
				.where(and(of, gt(messages.seq, covers), ne(messages.role, "summary")))
				.orderBy(asc(messages.seq));
			const head: Seqd[] = [];
			if (summary) {
				head.push({ message: summary.content as ModelMessage, seq: covers });
				if (!rest.some((r) => r.role === "user")) {
					const [user] = await db
						.select()
						.from(messages)
						.where(and(of, eq(messages.role, "user"), lte(messages.seq, covers)))
						.orderBy(desc(messages.seq))
						.limit(1);
					if (user) head.push({ message: user.content as ModelMessage, seq: user.seq });
				}
			}
			return [...head, ...rest.map((r) => ({ message: r.content as ModelMessage, seq: r.seq }))];
		},

		setRunStatus: (runId: string, status: RunStatus) =>
			db.update(runs).set({ status }).where(eq(runs.id, runId)),
	};
}

export type AgentStore = ReturnType<typeof agentStore>;
