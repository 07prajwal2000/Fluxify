import { generateID } from "@fluxify/lib";
import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { systemUsers } from "./auth-schema";
import { jsonb } from "./jsonbColumn";
import { projectsEntity } from "./schema";

/* ============================================================================
 * AGENT PERSISTENCE LAYER
 * ============================================================================ */

// Enums
export const agentConversationStatusEnum = pgEnum("agent_conversation_status", [
	"idle",
	"running",
	"paused_hitl",
	"interrupted",
	"completed",
	"failed",
]);

export const agentRunStatusEnum = pgEnum("agent_run_status", [
	"queued",
	"routing",
	"verifying",
	"planning",
	"orchestrating",
	"executing",
	"awaiting_hitl",
	"completed",
	"interrupted",
	"failed",
	// New agent (#645): stopped on a tool call the user has not answered yet.
	"waiting_approval",
]);

// 1. Conversations Table
export const agentConversationsEntity = pgTable(
	"agent_conversations",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		userId: varchar("user_id", { length: 50 }).references(() => systemUsers.id, {
			onDelete: "cascade",
		}),
		projectId: varchar("project_id", { length: 50 }).references(() => projectsEntity.id, {
			onDelete: "cascade",
		}),
		title: varchar({ length: 255 }).default("New Chat"),
		status: agentConversationStatusEnum("status").default("idle").notNull(),
		activeRunId: varchar("active_run_id", { length: 50 }),
		/** Pinned conversations sort first in the list. Forced back to false
		 *  whenever `archived` is set true. */
		pinned: boolean("pinned").default(false).notNull(),
		/** Archived conversations are hidden from the default list, can't be
		 *  pinned, and can't receive new messages. */
		archived: boolean("archived").default(false).notNull(),
		/** When the conversation was archived (#721). Deletion ages it out;
		 *  unarchiving clears it. Not `updated_at`, which moves on every change. */
		archivedAt: timestamp("archived_at"),
		metadata: jsonb("metadata").$type<Record<string, any>>(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(t) => [
		index("idx_agent_conv_user_id").on(t.userId),
		index("idx_agent_conv_project_id").on(t.projectId),
		index("idx_agent_conv_user_archived_pinned").on(t.userId, t.archived, t.pinned),
	],
);

// 2. Runs Table
export const agentRunsEntity = pgTable(
	"agent_runs",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		conversationId: varchar("conversation_id", { length: 50 })
			.references(() => agentConversationsEntity.id, {
				onDelete: "cascade",
			})
			.notNull(),
		userQuery: text("user_query").notNull(),
		status: agentRunStatusEnum("status").default("queued").notNull(),
		// What the run cost the provider: model calls, prompt/completion/cached
		// tokens, wall clock, and the same breakdown per agent. Written once when
		// the run reaches a terminal state; null for runs that never got there.
		usage: jsonb("usage").$type<Record<string, any>>(),
		// New agent (#647): the run stopped at its step or token limit, or (#696) its gateway died; null otherwise.
		stopReason: varchar("stop_reason", { length: 20 }).$type<
			"step_limit" | "token_budget" | "restarted"
		>(),
		interruptedAt: timestamp("interrupted_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		completedAt: timestamp("completed_at"),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(t) => [
		index("idx_agent_runs_conv_id").on(t.conversationId),
		index("idx_agent_runs_status").on(t.status),
	],
);

export const agentMessageRoleEnum = pgEnum("agent_message_role", [
	"user",
	"assistant",
	"tool",
	"summary",
]);

/** New agent (#645): one row per finished message, never edited. The UI shows
 *  every row; the model gets the latest summary plus the rows after it. */
export const agentMessagesEntity = pgTable(
	"agent_messages",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		conversationId: varchar("conversation_id", { length: 50 })
			.references(() => agentConversationsEntity.id, { onDelete: "cascade" })
			.notNull(),
		runId: varchar("run_id", { length: 50 })
			.references(() => agentRunsEntity.id, { onDelete: "cascade" })
			.notNull(),
		seq: integer("seq").notNull(),
		role: agentMessageRoleEnum("role").notNull(),
		/** The AI SDK ModelMessage as-is (reasoning and provider options included). */
		content: jsonb("content").$type<Record<string, any>>().notNull(),
		tokens: integer("tokens"),
		/** Summary rows only: the last seq the summary stands in for. */
		coversUpToSeq: integer("covers_up_to_seq"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [
		uniqueIndex("uq_agent_messages_conv_seq").on(t.conversationId, t.seq),
		index("idx_agent_messages_run_id").on(t.runId),
	],
);

/** One finding of an AI canvas review (#754), tied to the blocks it is about. */
export type ReviewFinding = {
	severity: "error" | "warning" | "info";
	category:
		| "security"
		| "error_handling"
		| "correctness"
		| "data_integrity"
		| "schema"
		| "performance"
		| "test_coverage";
	message: string;
	suggestedFix?: string;
	/** The blocks as the model named them (`db_native_1`) and as the canvas does; empty for the whole canvas. */
	blockKeys: string[];
	blockIds: string[];
	/** Set by the agent asked to fix it, once it fixed it or found it was not a problem. */
	resolution?: {
		status: "fixed" | "not_an_issue";
		note?: string;
		conversationId: string;
		at: string;
	};
};

/**
 * AI canvas review (#754): the latest review of one route or workflow. A new
 * review replaces the row and takes a new id, which is also its job's id.
 */
export const agentReviewsEntity = pgTable(
	"agent_reviews",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		projectId: varchar("project_id", { length: 50 })
			.references(() => projectsEntity.id, { onDelete: "cascade" })
			.notNull(),
		kind: varchar({ length: 20 }).$type<"route" | "workflow">().notNull(),
		targetId: varchar("target_id", { length: 50 }).notNull(),
		userId: varchar("user_id", { length: 50 }).references(() => systemUsers.id, {
			onDelete: "set null",
		}),
		status: varchar({ length: 20 })
			.$type<"running" | "completed" | "failed" | "cancelled">()
			.default("running")
			.notNull(),
		/** The canvas revision the review read; the report is stale once the canvas moves past it. */
		canvasRevision: integer("canvas_revision"),
		summary: text("summary"),
		findings: jsonb("findings").$type<ReviewFinding[]>(),
		error: text("error"),
		usage: jsonb("usage").$type<{ inputTokens: number; outputTokens: number }>(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		completedAt: timestamp("completed_at"),
		/** Touched by the job's heartbeat while it runs. */
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(t) => [uniqueIndex("uq_agent_reviews_target").on(t.kind, t.targetId)],
);

/* ============================================================================
 * RELATIONS
 * ============================================================================ */

export const agentConversationsRelations = relations(agentConversationsEntity, ({ many }) => ({
	runs: many(agentRunsEntity),
}));

export const agentRunsRelations = relations(agentRunsEntity, ({ one }) => ({
	conversation: one(agentConversationsEntity, {
		fields: [agentRunsEntity.conversationId],
		references: [agentConversationsEntity.id],
	}),
}));
