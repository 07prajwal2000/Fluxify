import { SQL } from "bun";
import { CompiledQuery, Kysely } from "kysely";
import { Connection, DbAdapterMode, DBConditionType, IDbAdapter } from ".";
import { JsVM } from "@fluxify/lib";
import { BunSqlMysqlDialect } from "./kyselySqlDialect";

export class MySqlAdapter implements IDbAdapter {
  private mode: DbAdapterMode = DbAdapterMode.NORMAL;
  private readonly HARD_LIMIT = 1000;

  // Held during a manual transaction
  private reservedConn: Awaited<ReturnType<SQL["reserve"]>> | null = null;
  private transactionDb: Kysely<any> | null = null;

  constructor(
    private readonly db: Kysely<any>,
    private readonly sql: SQL,
    private readonly vm: JsVM,
  ) {}

  public static createKysely(sql: SQL): Kysely<any> {
    return new Kysely<any>({ dialect: new BunSqlMysqlDialect(sql) });
  }

  /** Quick connectivity check. */
  public static async testConnection(
    connection: Connection,
  ): Promise<{ success: boolean; error?: unknown }> {
    const url =
      `mysql://${connection.username}:${encodeURIComponent(connection.password)}` +
      `@${connection.host}:${connection.port}/${connection.database}`;

    const sql = new SQL(url, { max: 1 });

    try {
      const result = await sql.unsafe("SELECT 1 AS test");
      return { success: (result as any)[0]?.test == 1 };
    } catch (error) {
      return { success: false, error };
    } finally {
      await sql.close();
    }
  }

  async raw(query: string | unknown, params?: any[]): Promise<any> {
    if (typeof query !== "string")
      throw new Error("raw() accepts only string queries.");

    const conn = this.getConnection();
    return conn.executeQuery(CompiledQuery.raw(query, params ?? []));
  }

  async getAll(
    table: string,
    conditions: DBConditionType[],
    limit: number = this.HARD_LIMIT,
    offset: number = 0,
    sort: { attribute: string; direction: "asc" | "desc" },
  ): Promise<unknown[]> {
    const conn = this.getConnection();
    let qb = conn.selectFrom(table);
    qb = this.buildQuery(conditions, qb);

    const l = limit < 0 || limit > this.HARD_LIMIT ? this.HARD_LIMIT : limit;

    return qb
      .selectAll()
      .limit(l)
      .offset(offset)
      .orderBy(sort.attribute, sort.direction)
      .execute();
  }

  async getSingle(
    table: string,
    conditions: DBConditionType[],
  ): Promise<unknown | null> {
    const conn = this.getConnection();
    let qb = conn.selectFrom(table);
    qb = this.buildQuery(conditions, qb);
    return (await qb.selectAll().executeTakeFirst()) ?? null;
  }

  async delete(table: string, conditions: DBConditionType[]): Promise<boolean> {
    const conn = this.getConnection();
    let qb = conn.deleteFrom(table);
    qb = this.buildQuery(conditions, qb);
    const result = await qb.execute();
    return Number(result[0]?.numDeletedRows ?? 0) > 0;
  }

  async insert(
    table: string,
    data: unknown,
    pkColumn: string = "id",
  ): Promise<any> {
    const conn = this.getConnection();

    const result = await conn
      .insertInto(table)
      .values(data as any)
      .executeTakeFirst();

    const insertId = result?.insertId;
    if (!insertId) return null;

    // Fetch the freshly inserted row.
    return conn
      .selectFrom(table)
      .selectAll()
      .where(pkColumn as any, "=", Number(insertId))
      .executeTakeFirst();
  }

  async insertBulk(
    table: string,
    data: any[],
    pkColumn: string = "id",
  ): Promise<any[]> {
    const chunkSize = 1000;
    const results: any[] = [];
    const conn = this.getConnection();

    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);

      const result = await conn
        .insertInto(table)
        .values(chunk)
        .executeTakeFirst();

      const firstId = result?.insertId;
      if (!firstId) continue;

      const lastId = Number(firstId) + chunk.length - 1;

      const rows = await conn
        .selectFrom(table)
        .selectAll()
        .where(pkColumn as any, ">=", Number(firstId))
        .where(pkColumn as any, "<=", lastId)
        .execute();

      results.push(...rows);
    }

    return results;
  }

  async update(
    table: string,
    data: unknown,
    conditions: DBConditionType[],
    pkColumn: string = "id",
  ): Promise<any> {
    const conn = this.getConnection();
    let qb = conn.updateTable(table).set(data as any);
    qb = this.buildQuery(conditions, qb);
    await qb.execute();

    // Re-fetch updated rows since MySQL has no RETURNING.
    let selectQb = conn.selectFrom(table);
    selectQb = this.buildQuery(conditions, selectQb);
    return selectQb.selectAll().execute();
  }

  async setMode(mode: DbAdapterMode): Promise<void> {
    this.mode = mode;
  }

  async startTransaction(): Promise<void> {
    if (this.mode === DbAdapterMode.TRANSACTION) return;

    this.reservedConn = await this.sql.reserve();

    try {
      await this.reservedConn.unsafe("BEGIN");
    } catch (e) {
      this.reservedConn.release();
      this.reservedConn = null;
      throw e;
    }

    const reservedSql = this.reservedConn as unknown as SQL;
    this.transactionDb = new Kysely<any>({
      dialect: new BunSqlMysqlDialect(reservedSql),
    });

    await this.setMode(DbAdapterMode.TRANSACTION);
  }

  async commitTransaction(): Promise<void> {
    if (this.mode !== DbAdapterMode.TRANSACTION || !this.reservedConn)
      throw new Error("Not in transaction mode");

    try {
      await this.reservedConn.unsafe("COMMIT");
    } finally {
      await this.transactionDb?.destroy();
      this.reservedConn.release();
      this.reservedConn = null;
      this.transactionDb = null;
      await this.setMode(DbAdapterMode.NORMAL);
    }
  }

  async rollbackTransaction(): Promise<void> {
    if (this.mode !== DbAdapterMode.TRANSACTION || !this.reservedConn)
      throw new Error("Not in transaction mode");

    try {
      await this.reservedConn.unsafe("ROLLBACK");
    } finally {
      await this.transactionDb?.destroy();
      this.reservedConn.release();
      this.reservedConn = null;
      this.transactionDb = null;
      await this.setMode(DbAdapterMode.NORMAL);
    }
  }

  private getConnection(): Kysely<any> {
    return this.mode === DbAdapterMode.TRANSACTION && this.transactionDb
      ? this.transactionDb
      : this.db;
  }

  private buildQuery(conditions: DBConditionType[], builder: any) {
    for (const condition of conditions) {
      const operator = this.getNativeOperator(condition.operator);
      if (condition.chain === "or") {
        builder = builder.orWhere(
          condition.attribute,
          operator,
          condition.value,
        );
      } else {
        builder = builder.where(condition.attribute, operator, condition.value);
      }
    }
    return builder;
  }

  private getNativeOperator(
    operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
  ): string {
    const map = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
    return map[operator] ?? "=";
  }
}

export function buildMysqlUrl(connection: Connection): string {
  const { username, password, host, port, database } = connection;
  return `mysql://${username}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

export function extractMysqlConnectionInfo(
  config: any,
  appConfigs: Map<string, string>,
  mysqlUrlParser: (url: string) => Connection | null,
) {
  if (config.source === "url") {
    config.url = config.url.startsWith("cfg:")
      ? (appConfigs.get(config.url.slice(4)) ?? "")
      : config.url;
    const result = mysqlUrlParser(config.url);
    if (result === null) return null;
    return {
      host: result.host,
      port: result.port,
      database: result.database,
      username: result.username,
      password: result.password,
      dbType: result.dbType,
    };
  }

  for (const key in config) {
    const value = config[key].toString();
    config[key] = value.startsWith("cfg:")
      ? (appConfigs.get(value.slice(4)) ?? "")
      : value;
  }
  return config;
}
