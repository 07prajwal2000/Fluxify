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
import { integrationsEntity, projectsEntity } from "./schema";

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
		aiResponse: text("ai_response"),
		// The AI integration this run used. `set null` keeps run history if the
		// integration is later deleted. Nullable so legacy runs (resolved from the
		// project's default integration) remain valid.
		integrationId: uuid("integration_id").references(() => integrationsEntity.id, {
			onDelete: "set null",
		}),
		status: agentRunStatusEnum("status").default("queued").notNull(),
		// What the run cost the provider: model calls, prompt/completion/cached
		// tokens, wall clock, and the same breakdown per agent. Written once when
		// the run reaches a terminal state; null for runs that never got there.
		usage: jsonb("usage").$type<Record<string, any>>(),
		// New agent (#647): the run stopped at its step or token limit; null otherwise.
		stopReason: varchar("stop_reason", { length: 20 }).$type<"step_limit" | "token_budget">(),
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
		index("idx_agent_runs_integration_id").on(t.integrationId),
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
