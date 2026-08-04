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
		// Read surface for the unified canvas: one pair of columns to filter on,
		// whatever the canvas belongs to. Kept as generated columns so the real
		// foreign keys (and their ON DELETE CASCADE) still own integrity — a bare
		// polymorphic parent_id cannot cascade.
		parentType: varchar("parent_type", { length: 20 }).generatedAlwaysAs(
			sql`CASE WHEN custom_block_id IS NOT NULL THEN 'custom_block' ELSE 'route' END`,
		),
		parentId: varchar("parent_id", { length: 50 }).generatedAlwaysAs(
			sql`COALESCE(route_id, custom_block_id)`,
		),
	},
	(table) => [
		index("idx_blocks_route_id").on(table.routeId),
		index("idx_blocks_custom_block_id").on(table.customBlockId),
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
		parentType: varchar("parent_type", { length: 20 }).generatedAlwaysAs(
			sql`CASE WHEN custom_block_id IS NOT NULL THEN 'custom_block' ELSE 'route' END`,
		),
		parentId: varchar("parent_id", { length: 50 }).generatedAlwaysAs(
			sql`COALESCE(route_id, custom_block_id)`,
		),
	},
	(table) => [
		index("idx_edges_from").on(table.from),
		index("idx_edges_to").on(table.to),
		index("idx_edges_route_id").on(table.routeId),
		index("idx_edges_custom_block_id").on(table.customBlockId),
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

