import { generateID } from "@fluxify/lib";
import { relations } from "drizzle-orm";
import {
	index,
	uniqueIndex,
	jsonb,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";
import { systemUsers } from "./auth-schema";
import { projectsEntity } from "./schema";

/* ============================================================================
 * AGENT HARNESS PERSISTENCE LAYER
 * ============================================================================ */

// Enums
export const agentHarnessConversationStatusEnum = pgEnum(
	"agent_harness_conversation_status",
	["idle", "running", "paused_hitl", "interrupted", "completed", "failed"],
);

export const agentHarnessRunStatusEnum = pgEnum(
	"agent_harness_run_status",
	[
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
	],
);

export const agentHarnessStepStatusEnum = pgEnum(
	"agent_harness_step_status",
	["pending", "running", "completed", "failed", "interrupted"],
);

export const agentHarnessLiveStateStatusEnum = pgEnum(
	"agent_harness_live_state_status",
	["running", "paused_hitl", "interrupted", "completed", "failed"],
);

export const agentHarnessHitlActionTypeEnum = pgEnum(
	"agent_harness_hitl_action_type",
	[
		"plan_approval",
		"plan_rejection",
		"user_input",
		"confirmation",
		"cancellation",
		"custom",
	],
);

// 1. Conversations Table
export const agentHarnessConversationsEntity = pgTable(
	"agent_harness_conversations",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		userId: varchar("user_id", { length: 50 }).references(() => systemUsers.id, {
			onDelete: "cascade",
		}),
		projectId: varchar("project_id", { length: 50 }).references(
			() => projectsEntity.id,
			{ onDelete: "cascade" },
		),
		title: varchar({ length: 255 }).default("New Chat"),
		status: agentHarnessConversationStatusEnum("status").default("idle").notNull(),
		activeRunId: varchar("active_run_id", { length: 50 }),
		metadata: jsonb("metadata").$type<Record<string, any>>(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(t) => [
		index("idx_harness_conv_user_id").on(t.userId),
		index("idx_harness_conv_project_id").on(t.projectId),
	],
);

// 2. Runs Table
export const agentHarnessRunsEntity = pgTable(
	"agent_harness_runs",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		conversationId: varchar("conversation_id", { length: 50 })
			.references(() => agentHarnessConversationsEntity.id, {
				onDelete: "cascade",
			})
			.notNull(),
		userQuery: text("user_query").notNull(),
		aiResponse: text("ai_response"),
		status: agentHarnessRunStatusEnum("status").default("queued").notNull(),
		interruptedAt: timestamp("interrupted_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		completedAt: timestamp("completed_at"),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(t) => [
		index("idx_harness_runs_conv_id").on(t.conversationId),
		index("idx_harness_runs_status").on(t.status),
	],
);

// 3. Execution Steps Table
export const agentHarnessStepsEntity = pgTable(
	"agent_harness_steps",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		runId: varchar("run_id", { length: 50 })
			.references(() => agentHarnessRunsEntity.id, { onDelete: "cascade" })
			.notNull(),
		conversationId: varchar("conversation_id", { length: 50 })
			.references(() => agentHarnessConversationsEntity.id, { onDelete: "cascade" })
			.notNull(),
		stepType: varchar("step_type", { length: 100 }).notNull(),
		stepOrder: serial("step_order"),
		subAgentRole: varchar("sub_agent_role", { length: 100 }),
		subAgentId: varchar("sub_agent_id", { length: 100 }),
		status: agentHarnessStepStatusEnum("status").default("pending").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(t) => [
		index("idx_harness_steps_run_id").on(t.runId),
		index("idx_harness_steps_sub_agent_id").on(t.subAgentId),
		uniqueIndex("uq_harness_steps_run_sub_agent").on(t.runId, t.subAgentId),
	],
);

// 4. Global Live State Table
export const agentHarnessLiveStatesEntity = pgTable(
	"agent_harness_live_states",
	{
		runId: varchar("run_id", { length: 50 })
			.primaryKey()
			.references(() => agentHarnessRunsEntity.id, { onDelete: "cascade" }),
		conversationId: varchar("conversation_id", { length: 50 })
			.references(() => agentHarnessConversationsEntity.id, { onDelete: "cascade" })
			.notNull(),
		currentState: agentHarnessLiveStateStatusEnum("current_state")
			.default("running")
			.notNull(),
		activeStepId: varchar("active_step_id", { length: 50 }),
		workingMemory: jsonb("working_memory")
			.$type<{
				orchestratorState?: Record<string, any>;
				pendingTasks?: any[];
				activeSubAgents?: Record<string, any>;
				[key: string]: any;
			}>()
			.notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(t) => [index("idx_harness_live_conv_id").on(t.conversationId)],
);

// 5. HITL Actions Table
export const agentHarnessHitlActionsEntity = pgTable(
	"agent_harness_hitl_actions",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		runId: varchar("run_id", { length: 50 })
			.references(() => agentHarnessRunsEntity.id, { onDelete: "cascade" })
			.notNull(),
		stepId: varchar("step_id", { length: 50 }).references(
			() => agentHarnessStepsEntity.id,
			{ onDelete: "cascade" },
		),
		actionType: agentHarnessHitlActionTypeEnum("action_type").notNull(),
		userResponse: jsonb("user_response").$type<Record<string, any> | null>(),
		performedAt: timestamp("performed_at").defaultNow().notNull(),
	},
	(t) => [
		index("idx_harness_hitl_run_id").on(t.runId),
		index("idx_harness_hitl_step_id").on(t.stepId),
	],
);

// 6. Artifacts Table
// The parent artifact is a grouping row that links a run to its sub-artifacts.
// The human-readable summary markdown is stored on the run (`aiResponse`) — the
// final result of the harness pass — not here.
export const agentHarnessArtifactsEntity = pgTable(
	"agent_harness_artifacts",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		conversationId: varchar("conversation_id", { length: 50 })
			.references(() => agentHarnessConversationsEntity.id, { onDelete: "cascade" })
			.notNull(),
		runId: varchar("run_id", { length: 50 })
			.references(() => agentHarnessRunsEntity.id, { onDelete: "cascade" })
			.notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [
		index("idx_harness_artifacts_conv_id").on(t.conversationId),
		index("idx_harness_artifacts_run_id").on(t.runId),
	],
);

// 7. Sub-Artifacts Table
// One row per sub-agent output referenced by the summary markdown. The special
// syntax tokens (@route, @canvasChanges) point at these rows by id so the
// frontend can render chips that open the actual implementation.
export const agentHarnessSubArtifactsEntity = pgTable(
	"agent_harness_sub_artifacts",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		artifactId: varchar("artifact_id", { length: 50 })
			.references(() => agentHarnessArtifactsEntity.id, { onDelete: "cascade" })
			.notNull(),
		conversationId: varchar("conversation_id", { length: 50 })
			.references(() => agentHarnessConversationsEntity.id, { onDelete: "cascade" })
			.notNull(),
		runId: varchar("run_id", { length: 50 })
			.references(() => agentHarnessRunsEntity.id, { onDelete: "cascade" })
			.notNull(),
		subAgentId: varchar("sub_agent_id", { length: 100 }),
		// "route" | "canvas"
		kind: varchar("kind", { length: 50 }).notNull(),
		// "add" | "delete" | "changes"
		action: varchar("action", { length: 50 }),
		payload: jsonb("payload").$type<Record<string, any>>().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [
		index("idx_harness_sub_artifacts_artifact_id").on(t.artifactId),
		index("idx_harness_sub_artifacts_run_id").on(t.runId),
	],
);

/* ============================================================================
 * RELATIONS
 * ============================================================================ */

export const agentHarnessConversationsRelations = relations(
	agentHarnessConversationsEntity,
	({ many }) => ({
		runs: many(agentHarnessRunsEntity),
		steps: many(agentHarnessStepsEntity),
		artifacts: many(agentHarnessArtifactsEntity),
	}),
);

export const agentHarnessRunsRelations = relations(
	agentHarnessRunsEntity,
	({ one, many }) => ({
		conversation: one(agentHarnessConversationsEntity, {
			fields: [agentHarnessRunsEntity.conversationId],
			references: [agentHarnessConversationsEntity.id],
		}),
		steps: many(agentHarnessStepsEntity),
		hitlActions: many(agentHarnessHitlActionsEntity),
		artifacts: many(agentHarnessArtifactsEntity),
		liveState: one(agentHarnessLiveStatesEntity, {
			fields: [agentHarnessRunsEntity.id],
			references: [agentHarnessLiveStatesEntity.runId],
		}),
	}),
);

export const agentHarnessStepsRelations = relations(
	agentHarnessStepsEntity,
	({ one, many }) => ({
		run: one(agentHarnessRunsEntity, {
			fields: [agentHarnessStepsEntity.runId],
			references: [agentHarnessRunsEntity.id],
		}),
		conversation: one(agentHarnessConversationsEntity, {
			fields: [agentHarnessStepsEntity.conversationId],
			references: [agentHarnessConversationsEntity.id],
		}),
		hitlActions: many(agentHarnessHitlActionsEntity),
	}),
);

export const agentHarnessLiveStatesRelations = relations(
	agentHarnessLiveStatesEntity,
	({ one }) => ({
		run: one(agentHarnessRunsEntity, {
			fields: [agentHarnessLiveStatesEntity.runId],
			references: [agentHarnessRunsEntity.id],
		}),
		conversation: one(agentHarnessConversationsEntity, {
			fields: [agentHarnessLiveStatesEntity.conversationId],
			references: [agentHarnessConversationsEntity.id],
		}),
	}),
);

export const agentHarnessHitlActionsRelations = relations(
	agentHarnessHitlActionsEntity,
	({ one }) => ({
		run: one(agentHarnessRunsEntity, {
			fields: [agentHarnessHitlActionsEntity.runId],
			references: [agentHarnessRunsEntity.id],
		}),
		step: one(agentHarnessStepsEntity, {
			fields: [agentHarnessHitlActionsEntity.stepId],
			references: [agentHarnessStepsEntity.id],
		}),
	}),
);

export const agentHarnessArtifactsRelations = relations(
	agentHarnessArtifactsEntity,
	({ one, many }) => ({
		conversation: one(agentHarnessConversationsEntity, {
			fields: [agentHarnessArtifactsEntity.conversationId],
			references: [agentHarnessConversationsEntity.id],
		}),
		run: one(agentHarnessRunsEntity, {
			fields: [agentHarnessArtifactsEntity.runId],
			references: [agentHarnessRunsEntity.id],
		}),
		subArtifacts: many(agentHarnessSubArtifactsEntity),
	}),
);

export const agentHarnessSubArtifactsRelations = relations(
	agentHarnessSubArtifactsEntity,
	({ one }) => ({
		artifact: one(agentHarnessArtifactsEntity, {
			fields: [agentHarnessSubArtifactsEntity.artifactId],
			references: [agentHarnessArtifactsEntity.id],
		}),
		conversation: one(agentHarnessConversationsEntity, {
			fields: [agentHarnessSubArtifactsEntity.conversationId],
			references: [agentHarnessConversationsEntity.id],
		}),
		run: one(agentHarnessRunsEntity, {
			fields: [agentHarnessSubArtifactsEntity.runId],
			references: [agentHarnessRunsEntity.id],
		}),
	}),
);
