import { generateID } from "@fluxify/lib";
import { sql, relations } from "drizzle-orm";
import {
	boolean,
	index,
	jsonb,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import z from "zod";
import { user } from "./auth-schema";
import { createSelectSchema } from "drizzle-zod";

/* ============================================================================
 * 1. GENERAL ENUMS & TYPES
 * ============================================================================ */

export enum HttpMethod {
	GET = "GET",
	POST = "POST",
	PUT = "PUT",
	DELETE = "DELETE",
}

/* ============================================================================
 * 2. PROJECT MANAGEMENT & CORE DOMAIN
 * ============================================================================ */

export const projectsEntity = pgTable(
	"projects",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		name: varchar({ length: 50 }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		hidden: boolean().default(false),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("idx_projects_id").on(table.id),
		index("idx_projects_name").on(table.name),
		index("idx_projects_updated_at").on(table.updatedAt),
	],
);

export const projectSettingsEntity = pgTable(
	"project_settings",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		projectId: varchar("project_id", { length: 50 }).references(
			() => projectsEntity.id,
			{
				onDelete: "cascade",
			},
		),
		key: varchar({ length: 50 }).notNull(),
		value: text().notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("idx_project_settings_project_id").on(table.projectId),
		index("idx_project_settings_key").on(table.key),
	],
);

/* ============================================================================
 * 3. ACCESS CONTROL & PERMISSIONS
 * ============================================================================ */

export const accessControlRoleEnum = pgEnum("access_control_roles", [
	"viewer", // Can view routes, but not configs/integrations
	"creator", //can CRUD routes, and CRU access to appconfigs and integrations, but No delete, View access to project settings
	"project_admin", // All Access for that project, assign/revoke users to projects, edit project configs
	"system_admin", // Access to everything in the system (create users as well)
]);

const accessControlRoleEnumSchema = createSelectSchema(accessControlRoleEnum);
export type AccessControlRole = z.infer<typeof accessControlRoleEnumSchema>;
export type AuthACL = {
	projectId: string;
	role: AccessControlRole;
};

export const accessControlEntity = pgTable(
	"access_control",
	{
		id: serial().primaryKey(),
		userId: varchar("user_id", { length: 50 }).references(() => user.id, {
			onDelete: "cascade",
		}),
		projectId: varchar("project_id", { length: 50 }).references(
			() => projectsEntity.id,
			{
				onDelete: "cascade",
			},
		),
		role: accessControlRoleEnum("role"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("idx_access_control_user_id").on(table.userId),
		index("idx_access_control_project_id").on(table.projectId),
	],
);

/* ============================================================================
 * 4. APP CONFIGURATIONS & INTEGRATIONS
 * ============================================================================ */

export const encodingTypeEnum = pgEnum("encoding_types", [
	"plaintext",
	"base64",
	"hex",
]);

export const appConfigDataTypeEnum = pgEnum("app_config_data_types", [
	"string",
	"number",
	"boolean",
]);

const encodingTypeValues = z.enum(encodingTypeEnum.enumValues);
const appConfigDataTypeValues = z.enum(appConfigDataTypeEnum.enumValues);

export type AppConfigEncodingTypes = z.infer<typeof encodingTypeValues>;
export type AppConfigDataTypes = z.infer<typeof appConfigDataTypeValues>;

export const appConfigEntity = pgTable(
	"app_config",
	{
		id: serial().primaryKey(),
		keyName: varchar("key_name", { length: 100 }),
		description: text(),
		value: text(),
		projectId: varchar("project_id", { length: 50 }).references(
			() => projectsEntity.id,
			{
				onDelete: "cascade",
			},
		),
		isEncrypted: boolean("is_encrypted").default(false),
		encodingType: encodingTypeEnum("encoding_type"),
		dataType: appConfigDataTypeEnum("data_type").default("string"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("idx_app_config_key_name").on(table.keyName),
		index("idx_app_config_project_id").on(table.projectId),
		index("idx_app_config_is_encrypted").on(table.isEncrypted),
		index("idx_app_config_encoding_type").on(table.encodingType),
		index("idx_app_config_key_name_fts").using("gin", sql`to_tsvector('english', ${table.keyName})`),
		index("idx_app_config_desc_fts").using("gin", sql`to_tsvector('english', coalesce(${table.description}, ''))`),
	],
);

export const integrationsEntity = pgTable(
	"integrations",
	{
		id: uuid()
			.$defaultFn(() => generateID())
			.primaryKey(),
		name: varchar({ length: 255 }),
		group: varchar({ length: 255 }),
		variant: varchar({ length: 255 }),
		config: jsonb(),
		tags: varchar({ length: 255 }).default(""),
		projectId: varchar("project_id", { length: 50 }).references(
			() => projectsEntity.id,
			{
				onDelete: "cascade",
			},
		),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("idx_integrations_name").on(table.name),
		index("idx_integrations_group").on(table.group),
		index("idx_integrations_variant").on(table.variant),
		index("idx_integrations_tags").on(table.tags),
		index("idx_integrations_project_id").on(table.projectId),
		index("idx_integrations_name_fts").using("gin", sql`to_tsvector('english', ${table.name})`),
	],
);

/* ============================================================================
 * 5. ROUTES & WORKFLOW CANVAS
 * ============================================================================ */

export const routesEntity = pgTable(
	"routes",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		name: varchar({ length: 255 }),
		path: text(),
		active: boolean().default(false),
		projectId: varchar("project_id", { length: 50 })
			.references(() => projectsEntity.id, {
				onDelete: "cascade",
			})
			.default(sql`NULL`),
		method: varchar({ length: 8 }),
		bodySchema: jsonb("body_schema"),
		querySchema: jsonb("query_schema"),
		paramsSchema: jsonb("params_schema"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: varchar("created_by", { length: 50 }),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("idx_routes_project_id").on(table.projectId),
		index("idx_routes_path").on(table.path),
		index("idx_routes_name_fts").using("gin", sql`to_tsvector('english', ${table.name})`),
	],
);

export const blocksEntity = pgTable(
	"blocks",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		type: varchar({ length: 100 }),
		position: jsonb("position").$type<{
			x: number;
			y: number;
		}>(),
		data: jsonb("data").$type<any>(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
		routeId: varchar("route_id", { length: 50 }).references(
			() => routesEntity.id,
			{
				onDelete: "cascade",
			},
		),
	},
	(table) => [index("idx_blocks_route_id").on(table.routeId)],
);

export const edgesEntity = pgTable(
	"edges",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		from: varchar({ length: 50 }).references(() => blocksEntity.id, {
			onDelete: "cascade",
		}),
		to: varchar({ length: 50 }).references(() => blocksEntity.id, {
			onDelete: "cascade",
		}),
		fromHandle: varchar("from_handle", { length: 50 }),
		toHandle: varchar("to_handle", { length: 50 }),
		routeId: varchar("route_id", { length: 50 }).references(
			() => routesEntity.id,
			{
				onDelete: "cascade",
			},
		),
	},
	(table) => [
		index("idx_edges_from").on(table.from),
		index("idx_edges_to").on(table.to),
		index("idx_edges_route_id").on(table.routeId),
	],
);

/* ============================================================================
 * 6. TESTING & TEST SUITES
 * ============================================================================ */

export const testSuitesEntity = pgTable("test_suites", {
	id: varchar({ length: 50 })
		.primaryKey()
		.$defaultFn(() => generateID()),
	name: varchar({ length: 255 }).notNull(),
	description: text(),
	routeId: varchar("route_id", { length: 50 })
		.notNull()
		.references(() => routesEntity.id, { onDelete: "cascade" }),

	// Mock request data
	headers: jsonb("headers").$type<Record<string, string>>().default({}),
	params: jsonb("params").$type<Record<string, string>>().default({}),
	queryParams: jsonb("query_params")
		.$type<Record<string, string>>()
		.default({}),
	routeParams: jsonb("route_params")
		.$type<Record<string, string>>()
		.default({}),
	body: jsonb("body").$type<Record<string, unknown>>(),

	// Assertions
	assertions: jsonb("assertions").$type<any[]>().notNull().default([]),

	// Overrides
	integrationOverrides: jsonb("integration_overrides")
		.$type<Array<{ existingId: string; newId: string }>>()
		.default([]),
	appConfigOverrides: jsonb("app_config_overrides")
		.$type<Array<{ key: string; value: string }>>()
		.default([]),

	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.notNull()
		.$onUpdate(() => new Date()),
});

export const testSuitesRelations = relations(testSuitesEntity, ({ one }) => ({
	route: one(routesEntity, {
		fields: [testSuitesEntity.routeId],
		references: [routesEntity.id],
	}),
}));

export const routesRelations = relations(routesEntity, ({ many }) => ({
	testSuites: many(testSuitesEntity),
}));

/* ============================================================================
 * 7. CUSTOM BLOCKS EXTENSIONS
 * ============================================================================ */

export const customBlockIconTypeEnum = pgEnum("custom_block_icon_type", [
	"premade-list",
	"custom",
]);

export const customBlockSourceTypeEnum = pgEnum("custom_block_source_type", [
	"plugin", // from third party sources
	"inhouse", // built-in or can be added as addon but developed by the project maintainers
	"user-defined", // custom defined by the user for their project
]);

export const customBlocksListEntity = pgTable(
	"custom_blocks_list",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		name: varchar({ length: 50 }).notNull(),
		label: varchar({ length: 50 }).notNull(),
		description: text(),
		icon: customBlockIconTypeEnum("icon"),
		iconUrl: text("icon_url"), // if custom, then it is either url or base64 encoded. if premade-list, then it is the name of the icon in the list
		projectId: varchar("project_id", { length: 50 }).references(
			() => projectsEntity.id,
			{
				onDelete: "cascade",
			},
		),
		inputParams: jsonb("input_params").$type<Record<string, any>[]>(),
		sourceType:
			customBlockSourceTypeEnum("source_type").default("user-defined"),
		source: text().default(""), // if plugin, then the name of plugin, if inhouse, then repository url, if user-defined, then empty
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("idx_custom_blocks_list_project_id").on(table.projectId),
		index("idx_custom_blocks_list_name").on(table.name),
	],
);

export const customBlockGraphsEntity = pgTable(
	"custom_block_graphs",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		customBlockId: varchar("custom_block_id", { length: 50 }).references(
			() => customBlocksListEntity.id,
			{
				onDelete: "cascade",
			},
		),
		type: varchar({ length: 100 }),
		data: jsonb("data").$type<any>(),
		next: varchar("next_block_id", { length: 50 }),
	},
	(table) => [
		index("idx_custom_block_graphs_custom_block_id").on(table.customBlockId),
	],
);

/* ============================================================================
 * 8. AI ASSISTANT & WORKFLOW BUILDER
 * ============================================================================ */

export const aiChatConversationStatusEnum = pgEnum(
	"ai_chat_conversation_status",
	["not_started", "running", "success", "error", "paused", "plan_rejected"],
);

export const aiConversationLocationEnum = z.enum(["canvas", "ai_window"]);

export const aiChatConversationsEntity = pgTable("ai_chat_conversations", {
	id: varchar({ length: 50 })
		.primaryKey()
		.$defaultFn(() => generateID()),
	userId: varchar("user_id", { length: 50 }).references(() => user.id, {
		onDelete: "cascade",
	}),
	title: varchar({ length: 255 }).default("New chat"),
	projectId: varchar("project_id", { length: 50 }).references(
		() => projectsEntity.id,
		{
			onDelete: "cascade",
		},
	),
	metadata: jsonb("metadata")
		.$type<{
			location: z.infer<typeof aiConversationLocationEnum>;
			routeId?: string;
		}>()
		.notNull(),
	status: aiChatConversationStatusEnum("status").default("not_started"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.notNull()
		.$onUpdate(() => new Date()),
});

export const aiChatHistoryEntity = pgTable("ai_chat_history", {
	id: varchar({ length: 50 })
		.primaryKey()
		.$defaultFn(() => generateID()),
	conversationId: varchar("conversation_id", { length: 50 })
		.references(() => aiChatConversationsEntity.id, {
			onDelete: "cascade",
		})
		.notNull(),
	status: aiChatConversationStatusEnum("status").default("running"),
	userQuery: text("user_query").notNull(),
	finalOutput: jsonb("final_output").$type<{
		nodeId: string;
		result: any;
	}>(),
	workflowExecutionHistory: jsonb("workflow_execution_history")
		.$type<
			{
				type: "node" | "tool";
				id: string;
				status: "running" | "success" | "failure";
			}[]
		>()
		.notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const aiWorkflowBuilderStepTypeEnum = pgEnum(
	"ai_workflow_builder_step_type",
	["verify", "planner", "orchestrator", "sub_agent", "evaluator"],
);

export const aiWorkflowBuilderStepStatusEnum = pgEnum(
	"ai_workflow_builder_step_status",
	["running", "completed", "failed", "paused", "awaiting_review"],
);

export const aiWorkflowBuilderStepsEntity = pgTable(
	"ai_workflow_builder_steps",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		chatHistoryId: varchar("chat_history_id", { length: 50 })
			.references(() => aiChatHistoryEntity.id, { onDelete: "cascade" })
			.notNull(),
		conversationId: varchar("conversation_id", { length: 50 })
			.references(() => aiChatConversationsEntity.id, { onDelete: "cascade" })
			.notNull(),
		stepType: aiWorkflowBuilderStepTypeEnum("step_type").notNull(),
		stepStatus: aiWorkflowBuilderStepStatusEnum("step_status")
			.default("running")
			.notNull(),
		stepOrder: serial("step_order"),
		inputData: jsonb("input_data").$type<any>(),
		outputData: jsonb("output_data").$type<any>(),
		metadata: jsonb("metadata").$type<{
			nodeId: string;
			stepSource: string;
			tokenUsage?: { input: number; output: number };
		}>(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("idx_ai_wf_steps_chat_history_id").on(table.chatHistoryId),
		index("idx_ai_wf_steps_conversation_id").on(table.conversationId),
		index("idx_ai_wf_steps_step_type").on(table.stepType),
		index("idx_ai_wf_steps_step_status").on(table.stepStatus),
	],
);

/* ============================================================================
 * INSTANCE SETTINGS (dynamic public/private config, e.g. SSO/auth mode)
 * ============================================================================ */

export const instanceSettingCategoryEnum = pgEnum("instance_setting_category", [
	"auth",
]); // add values as new categories appear

export const instanceSettingsEntity = pgTable("instance_settings", {
	id: varchar({ length: 50 })
		.primaryKey()
		.$defaultFn(() => generateID()),
	key: varchar({ length: 100 }).notNull().unique(),
	category: instanceSettingCategoryEnum("category").notNull(),
	value: jsonb().$type<Record<string, unknown>>().notNull(),
	isPublic: boolean("is_public").default(false).notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at")
		.defaultNow()
		.notNull()
		.$onUpdate(() => new Date()),
});

export * from "./agent-harness-schema";

