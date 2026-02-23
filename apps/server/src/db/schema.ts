import { generateID } from "@fluxify/lib";
import { sql, relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  json,
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

export enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
}

export const projectsEntity = pgTable(
  "projects",
  {
    id: varchar({ length: 50 }).primaryKey().default(generateID()),
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
    id: varchar({ length: 50 }).primaryKey().default(generateID()),
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

// export disabled. feature not ready for production
const aiChatEntity = pgTable(
  "ai_chat",
  {
    id: varchar({ length: 50 }).primaryKey().default(generateID()),
    role: varchar({ length: 50 }),
    content: text(),
    userId: varchar("user_id", { length: 50 }).references(() => user.id, {
      onDelete: "cascade",
    }),
    metadata: jsonb("metadata").$type<{
      type: "general" | "builder_proposal" | "clarification_needed";
      nodes?: any[];
      edges?: any[];
      reason?: string; // If build failed
    }>(),
    // any action to perform in ui (to track for duplication or future use)
    // available: pending, implemented
    actionState: varchar("action_state", { length: 50 }).default("pending"),
    routeId: varchar("route_id", { length: 50 }).references(
      () => routesEntity.id,
      {
        onDelete: "cascade",
      },
    ),
    tokenUsage: integer("token_usage").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_ai_chat_route_id").on(table.routeId),
    index("idx_ai_chat_created_at").on(table.createdAt),
    index("idx_ai_chat_user_id").on(table.userId),
  ],
);

export const routesEntity = pgTable(
  "routes",
  {
    id: varchar({ length: 50 }).primaryKey().default(generateID()),
    name: varchar({ length: 50 }),
    path: text(),
    active: boolean().default(false),
    projectId: varchar("project_id", { length: 50 })
      .references(() => projectsEntity.id, {
        onDelete: "cascade",
      })
      .default(sql`NULL`),
    method: varchar({ length: 8 }),
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
  ],
);

export const blocksEntity = pgTable(
  "blocks",
  {
    id: varchar({ length: 50 }).primaryKey().default(generateID()),
    type: varchar({ length: 100 }),
    position: json(),
    data: json(),
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
    id: varchar({ length: 50 }).primaryKey().default(generateID()),
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
    index("idx_app_config_is_encrypted").on(table.isEncrypted),
    index("idx_app_config_encoding_type").on(table.encodingType),
  ],
);

export const integrationsEntity = pgTable(
  "integrations",
  {
    id: uuid().primaryKey(),
    name: varchar({ length: 255 }),
    group: varchar({ length: 255 }),
    variant: varchar({ length: 255 }),
    config: jsonb(),
  },
  (table) => [
    index("idx_integrations_name").on(table.name),
    index("idx_integrations_group").on(table.group),
    index("idx_integrations_variant").on(table.variant),
  ],
);

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
