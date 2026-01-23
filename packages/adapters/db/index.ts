import { operatorSchema } from "@fluxify/lib";
import z from "zod";
import { Connection, DbType } from "./connection";
import { PostgresAdapter } from "./postgresAdapter";
import knex, { Knex } from "knex";
import { JsVM } from "@fluxify/lib";

export const whereConditionSchema = z.object({
  attribute: z.string(),
  operator: operatorSchema.exclude(["js"]),
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
      const knexConn = this.getKnexConnection(connection, cfg);
      return (this.connectionMap[connection] = new PostgresAdapter(
        knexConn,
        this.vm,
      ));
    }
    throw new Error("MongoDB Not implemented");
  }

  private static knexConnectionCache: Record<string, Knex> = {};

  private getKnexConnection(connection: string, cfg: Connection) {
    if (connection in DbFactory.knexConnectionCache) {
      return DbFactory.knexConnectionCache[connection];
    }
    return (DbFactory.knexConnectionCache[connection] = knex({
      client: "pg",
      connection: {
        host: cfg.host,
        port: Number(cfg.port),
        user: cfg.username,
        password: cfg.password,
        database: cfg.database,
      },
    }));
  }
  // called when appconfig/integration changed
  public static async ResetConnections() {
    const proms: Promise<any>[] = [];
    for (let conn in this.knexConnectionCache) {
      proms.push(this.knexConnectionCache[conn].destroy());
    }
    this.knexConnectionCache = {};
    try {
      await Promise.allSettled(proms);
    } catch (error) {}
  }
}

export * from "./postgresAdapter";
export * from "./connection";
