import { SQL } from "bun";
import { Kysely } from "kysely";
import { operatorSchema } from "@fluxify/lib";
import z from "zod";
import { Connection, DbType } from "./connection";
import { PostgresAdapter } from "./postgresAdapter";
import { MySqlAdapter } from "./mySqlAdapter";
import { JsVM } from "@fluxify/lib";
import { BunSqlPostgresDialect, BunSqlMysqlDialect } from "./kyselySqlDialect";

export const whereConditionSchema = z.object({
  attribute: z.string(),
  operator: operatorSchema.exclude(["js", "is_empty", "is_not_empty"]),
  value: z.string().or(z.number()),
  chain: z.enum(["and", "or"]),
});

export type DBConditionType = z.infer<typeof whereConditionSchema>;

export enum DbAdapterMode {
  NORMAL = 1,
  TRANSACTION = 2,
}

export interface IDbAdapter {
  getAll(
    table: string,
    conditions: DBConditionType[],
    limit: number,
    offset: number,
    sort: { attribute: string; direction: "asc" | "desc" },
  ): Promise<unknown[]>;
  getSingle(
    table: string,
    conditions: DBConditionType[],
  ): Promise<unknown | null>;
  insert(table: string, data: unknown): Promise<any>;
  insertBulk(table: string, data: unknown[]): Promise<any>;
  update(
    table: string,
    data: unknown,
    conditions: DBConditionType[],
  ): Promise<any>;
  raw(query: string | unknown, params?: any[]): Promise<any>;
  delete(table: string, conditions: DBConditionType[]): Promise<boolean>;
  setMode(mode: DbAdapterMode): Promise<void>;
  startTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
}

export class DbFactory {
  private readonly connectionMap: Record<string, IDbAdapter> = {};

  constructor(
    private readonly vm: JsVM,
    private readonly dbConfig: Record<string, Connection>,
  ) {}

  public getDbAdapter(connection: string): IDbAdapter {
    const cfg = this.dbConfig[connection];
    if (!cfg) {
      throw new Error("config is null while creating db adapter");
    }
    if (connection in this.connectionMap) return this.connectionMap[connection];

    if (cfg.dbType === DbType.POSTGRES) {
      const { db, sql } = this.getBunSqlConnection(connection, cfg, "postgres");
      return (this.connectionMap[connection] = new PostgresAdapter(
        db,
        sql,
        this.vm,
      ));
    }

    if (cfg.dbType === DbType.MYSQL) {
      const { db, sql } = this.getBunSqlConnection(connection, cfg, "mysql");
      return (this.connectionMap[connection] = new MySqlAdapter(
        db,
        sql,
        this.vm,
      ));
    }

    throw new Error("MongoDB Not implemented");
  }

  private static connectionCache: Record<
    string,
    { db: Kysely<any>; sql: SQL }
  > = {};

  private getBunSqlConnection(
    connection: string,
    cfg: Connection,
    adapter: "postgres" | "mysql",
  ): { db: Kysely<any>; sql: SQL } {
    if (connection in DbFactory.connectionCache) {
      return DbFactory.connectionCache[connection];
    }

    const sql = new SQL({
      adapter,
      hostname: cfg.host,
      port: Number(cfg.port),
      username: cfg.username,
      password: cfg.password,
      database: cfg.database,
      ...(adapter === "postgres" && cfg.ssl ? { tls: true } : {}),
    });

    const dialect =
      adapter === "postgres"
        ? new BunSqlPostgresDialect(sql)
        : new BunSqlMysqlDialect(sql);

    const db = new Kysely<any>({ dialect });

    return (DbFactory.connectionCache[connection] = { db, sql });
  }

  /** Call when app config / integration credentials change. */
  public static async ResetConnections() {
    const proms = Object.values(this.connectionCache).map(({ db, sql }) =>
      db.destroy().then(() => sql.close()),
    );
    this.connectionCache = {};
    await Promise.allSettled(proms);
  }
}

export * from "./postgresAdapter";
export * from "./mySqlAdapter";
export * from "./connection";
