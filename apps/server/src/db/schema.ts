import { generateID } from "@fluxify/lib";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
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
    index("idx_projects_name").on(table.name),
    index("idx_projects_updated_at").on(table.updatedAt),
  ]
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
  ]
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
      }
    ),
  },
  (table) => [index("idx_blocks_route_id").on(table.routeId)]
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
      }
    ),
  },
  (table) => [
    index("idx_edges_from").on(table.from),
    index("idx_edges_to").on(table.to),
    index("idx_edges_route_id").on(table.routeId),
  ]
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
  ]
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
  ]
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
      }
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
  ]
);
