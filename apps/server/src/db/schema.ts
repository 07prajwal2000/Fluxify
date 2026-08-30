import { generateID } from "@fluxify/lib";
import { sql, relations } from "drizzle-orm";
import {
	boolean,
	integer,
	index,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { jsonb } from "./jsonbColumn";
import z from "zod";
import { systemUsers } from "./auth-schema";
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
		description: text(),
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
		userId: varchar("user_id", { length: 50 }).references(() => systemUsers.id, {
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
		// Users search integrations by what they are ("postgres", "openai") as
		// often as by what they named them.
		index("idx_integrations_meta_fts").using(
			"gin",
			sql`to_tsvector('english', coalesce(${table.group}, '') || ' ' || coalesce(${table.variant}, '') || ' ' || coalesce(${table.tags}, ''))`,
		),
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
		/** CPU-stall budget for compiled execution; users may raise but not lower it. */
		timeoutSeconds: integer("timeout_seconds").default(30).notNull(),
		/**
		 * Two independent switches, deliberately not one:
		 * `tracingEnabled` exports spans to the project's own OTEL destination and
		 * stores nothing here; `recordExecution` persists a debug recording for the
		 * portal trace viewer and is expensive, so it stays off by default.
		 */
		tracingEnabled: boolean("tracing_enabled").default(false).notNull(),
		recordExecution: boolean("record_execution").default(false).notNull(),
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
		// `/api/users/:id` is one indivisible token to the text-search parser —
		// splitting on the separators is what makes "users" match.
		index("idx_routes_path_fts").using(
			"gin",
			sql`to_tsvector('english', translate(coalesce(${table.path}, ''), '/:-_', '    '))`,
		),
	],
);

/**
 * A workflow is a background DAG: same canvas, same compiler, no HTTP surface.
 *
 * It is deliberately not a row in `routes` with a flag. A route is defined by
 * how it is addressed — method, path, request schemas — and a workflow has none
 * of that; it is addressed by a trigger. Sharing the table would mean six
 * always-null columns and every route query growing a filter it can forget.
 *
 * The canvas itself is not duplicated: blocks and edges point here through a
 * third parent, exactly as custom blocks do.
 */
export const workflowsEntity = pgTable(
	"workflows",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		name: varchar({ length: 255 }),
		description: text(),
		active: boolean().default(false),
		projectId: varchar("project_id", { length: 50 })
			.references(() => projectsEntity.id, {
				onDelete: "cascade",
			})
			.default(sql`NULL`),
		/** CPU-stall budget. A background job may legitimately want more than a request. */
		timeoutSeconds: integer("timeout_seconds").default(300).notNull(),
		/** Same two independent switches as a route — see `routesEntity`. */
		tracingEnabled: boolean("tracing_enabled").default(false).notNull(),
		recordExecution: boolean("record_execution").default(false).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		createdBy: varchar("created_by", { length: 50 }),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		index("idx_workflows_project_id").on(table.projectId),
		index("idx_workflows_name_fts").using(
			"gin",
			sql`to_tsvector('english', ${table.name})`,
		),
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
		customBlockId: varchar("custom_block_id", { length: 50 }).references(
			() => customBlocksListEntity.id,
			{
				onDelete: "cascade",
			},
		),
		workflowId: varchar("workflow_id", { length: 50 }).references(
			() => workflowsEntity.id,
			{
				onDelete: "cascade",
			},
		),
		// Read surface for the unified canvas: one pair of columns to filter on,
		// whatever the canvas belongs to. Kept as generated columns so the real
		// foreign keys (and their ON DELETE CASCADE) still own integrity — a bare
		// polymorphic parent_id cannot cascade.
		parentType: varchar("parent_type", { length: 20 }).generatedAlwaysAs(
			sql`CASE WHEN custom_block_id IS NOT NULL THEN 'custom_block' WHEN workflow_id IS NOT NULL THEN 'workflow' ELSE 'route' END`,
		),
		parentId: varchar("parent_id", { length: 50 }).generatedAlwaysAs(
			sql`COALESCE(route_id, custom_block_id, workflow_id)`,
		),
	},
	(table) => [
		index("idx_blocks_route_id").on(table.routeId),
		index("idx_blocks_custom_block_id").on(table.customBlockId),
		index("idx_blocks_workflow_id").on(table.workflowId),
		index("idx_blocks_parent").on(table.parentType, table.parentId),
	],
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
		customBlockId: varchar("custom_block_id", { length: 50 }).references(
			() => customBlocksListEntity.id,
			{
				onDelete: "cascade",
			},
		),
		workflowId: varchar("workflow_id", { length: 50 }).references(
			() => workflowsEntity.id,
			{
				onDelete: "cascade",
			},
		),
		parentType: varchar("parent_type", { length: 20 }).generatedAlwaysAs(
			sql`CASE WHEN custom_block_id IS NOT NULL THEN 'custom_block' WHEN workflow_id IS NOT NULL THEN 'workflow' ELSE 'route' END`,
		),
		parentId: varchar("parent_id", { length: 50 }).generatedAlwaysAs(
			sql`COALESCE(route_id, custom_block_id, workflow_id)`,
		),
	},
	(table) => [
		index("idx_edges_from").on(table.from),
		index("idx_edges_to").on(table.to),
		index("idx_edges_route_id").on(table.routeId),
		index("idx_edges_custom_block_id").on(table.customBlockId),
		index("idx_edges_workflow_id").on(table.workflowId),
		index("idx_edges_parent").on(table.parentType, table.parentId),
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

export const testRunStatusEnum = pgEnum("test_run_status", [
	"queued",
	"running",
	"passed",
	"failed",
	"timeout",
	"error",
]);

export type TestRunStatus = (typeof testRunStatusEnum.enumValues)[number];

/** One assertion verdict — same shape the in-process runner already returns. */
export type AssertionResult = { success: boolean; message: string };

/** jsonb payload on a single suite run. */
export type SuiteRunResult = {
	success: boolean;
	result: AssertionResult[];
	/** Raw response body the suite's request produced. */
	actualData?: unknown;
	statusCode?: number;
	headers?: Record<string, string>;
	error?: string;
};

/** jsonb payload on the parent run. */
export type TestRunSummary = {
	total: number;
	passed: number;
	failed: number;
	/** suite id -> terminal status */
	suites: Record<string, TestRunStatus>;
	error?: string;
};

/**
 * A test run is one request to execute suites for a route: one parent row plus a
 * child row per suite, written as each suite settles so the UI can poll progress.
 *
 * ponytail: results are pinned to no code version — tests always run the latest
 * graph. When version control lands, add `versionId` to BOTH tables, otherwise a
 * past failure can never be reproduced.
 * ponytail: no retention job — rows grow unbounded. Add a scheduled delete
 * (30 days) when the table gets big enough to notice.
 */
export const testRunsEntity = pgTable(
	"test_runs",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		projectId: varchar("project_id", { length: 50 })
			.notNull()
			.references(() => projectsEntity.id, { onDelete: "cascade" }),
		routeId: varchar("route_id", { length: 50 })
			.notNull()
			.references(() => routesEntity.id, { onDelete: "cascade" }),
		status: testRunStatusEnum("status").default("queued").notNull(),
		totalSuites: integer("total_suites").notNull(),
		passedCount: integer("passed_count").default(0).notNull(),
		failedCount: integer("failed_count").default(0).notNull(),
		result: jsonb("result").$type<TestRunSummary | null>(),
		durationMs: integer("duration_ms"),
		startedAt: timestamp("started_at"),
		finishedAt: timestamp("finished_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("idx_test_runs_project_route").on(
			table.projectId,
			table.routeId,
			table.createdAt,
		),
	],
);

export const testSuiteRunsEntity = pgTable(
	"test_suite_runs",
	{
		id: varchar({ length: 50 })
			.primaryKey()
			.$defaultFn(() => generateID()),
		testRunId: varchar("test_run_id", { length: 50 })
			.notNull()
			.references(() => testRunsEntity.id, { onDelete: "cascade" }),
		// Denormalized so filtering run history by project needs no join through routes.
		projectId: varchar("project_id", { length: 50 })
			.notNull()
			.references(() => projectsEntity.id, { onDelete: "cascade" }),
		routeId: varchar("route_id", { length: 50 })
			.notNull()
			.references(() => routesEntity.id, { onDelete: "cascade" }),
		// Deliberately NOT a foreign key: deleting a suite must not erase the
		// history of the runs that used it.
		testSuiteId: varchar("test_suite_id", { length: 50 }).notNull(),
		status: testRunStatusEnum("status").default("queued").notNull(),
		result: jsonb("result").$type<SuiteRunResult | null>(),
		durationMs: integer("duration_ms"),
		startedAt: timestamp("started_at"),
		finishedAt: timestamp("finished_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("idx_test_suite_runs_run").on(table.testRunId),
		index("idx_test_suite_runs_project").on(table.projectId, table.createdAt),
	],
);

export const testRunsRelations = relations(testRunsEntity, ({ many, one }) => ({
	suiteRuns: many(testSuiteRunsEntity),
	route: one(routesEntity, {
		fields: [testRunsEntity.routeId],
		references: [routesEntity.id],
	}),
}));

export const testSuiteRunsRelations = relations(
	testSuiteRunsEntity,
	({ one }) => ({
		testRun: one(testRunsEntity, {
			fields: [testSuiteRunsEntity.testRunId],
			references: [testRunsEntity.id],
		}),
	}),
);

export const testSuitesRelations = relations(testSuitesEntity, ({ one }) => ({
	route: one(routesEntity, {
		fields: [testSuitesEntity.routeId],
		references: [routesEntity.id],
	}),
}));

export const routesRelations = relations(routesEntity, ({ many }) => ({
	testSuites: many(testSuitesEntity),
}));

/**
 * Per-route knobs that are not worth a column each. One row per route, keyed by
 * the route itself: `route_config` is an open bag so a new setting is a change
 * to `lib/routeConfig.ts`, not a migration. A route with no row uses defaults.
 */
export const httpRouteConfigEntity = pgTable(
	"http_route_config",
	{
		routeId: varchar("route_id", { length: 50 })
			.primaryKey()
			.references(() => routesEntity.id, { onDelete: "cascade" }),
		projectId: varchar("project_id", { length: 50 }).references(
			() => projectsEntity.id,
			{ onDelete: "cascade" },
		),
		routeConfig: jsonb("route_config")
			.$type<Record<string, unknown>>()
			.default({})
			.notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(table) => [index("idx_http_route_config_project_id").on(table.projectId)],
);

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

// Custom block canvases live in `blocks`/`edges` alongside route canvases —
// see `modules/canvas`. The old `custom_block_graphs` table is gone.

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

