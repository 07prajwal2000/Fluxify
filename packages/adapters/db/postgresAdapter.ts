import { SQL } from "bun";
import { CompiledQuery, Kysely } from "kysely";
import { Connection, DbAdapterMode, DBConditionType, IDbAdapter } from ".";
import { JsVM } from "@fluxify/lib";
import { BunSqlPostgresDialect } from "./kyselySqlDialect";

export class PostgresAdapter implements IDbAdapter {
  private mode: DbAdapterMode = DbAdapterMode.NORMAL;
  private readonly HARD_LIMIT = 1000;

  // Held during a manual transaction
  private reservedConn: Awaited<ReturnType<SQL["reserve"]>> | null = null;
  // Kysely instance scoped to the reserved connection
  private transactionDb: Kysely<any> | null = null;

  constructor(
    private readonly db: Kysely<any>,
    private readonly sql: SQL, // Bun.SQL instance (replaces Pool)
    private readonly vm: JsVM,
  ) {}

  // ------------------------------------------------------------------
  // Static factory helpers
  // ------------------------------------------------------------------

  /**
   * Build a Kysely<any> instance backed by Bun's native Postgres client.
   *
   * Example:
   *   const sql = new SQL("postgres://user:pass@localhost/mydb");
   *   const db  = PostgresAdapter.createKysely(sql);
   *   const adapter = new PostgresAdapter(db, sql, vm);
   */
  public static createKysely(sql: SQL): Kysely<any> {
    return new Kysely<any>({ dialect: new BunSqlPostgresDialect(sql) });
  }

  /** Quick connectivity check — throws on failure. */
  public static async testConnection(
    connection: Connection,
  ): Promise<{ success: boolean; error?: unknown }> {
    const url =
      `postgres://${connection.username}:${connection.password}` +
      `@${connection.host}:${connection.port}/${connection.database}`;

    const sql = new SQL(url, {
      tls: connection.ssl,
      max: 2,
    });

    try {
      const result = await sql.unsafe("SELECT 1 AS test");
      return { success: (result as any)[0]?.test == 1 };
    } catch (error) {
      return { success: false, error };
    } finally {
      await sql.close();
    }
  }

  // ------------------------------------------------------------------
  // Raw query
  // ------------------------------------------------------------------

  async raw(query: string | unknown, params?: any[]): Promise<any> {
    if (typeof query !== "string")
      throw new Error("raw() accepts only string queries.");

    const conn = this.getConnection();
    return conn.executeQuery(CompiledQuery.raw(query, params ?? []));
  }

  // ------------------------------------------------------------------
  // SELECT helpers
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // Mutating helpers
  // ------------------------------------------------------------------

  async delete(table: string, conditions: DBConditionType[]): Promise<boolean> {
    const conn = this.getConnection();
    let qb = conn.deleteFrom(table);
    qb = this.buildQuery(conditions, qb);
    const result = await qb.execute();
    return Number(result[0]?.numDeletedRows ?? 0) > 0;
  }

  async insert(table: string, data: unknown): Promise<any> {
    const conn = this.getConnection();
    return conn
      .insertInto(table)
      .values(data as any)
      .returningAll()
      .execute();
  }

  async insertBulk(table: string, data: any[]): Promise<any> {
    const chunkSize = 1000;
    const results: any[] = [];
    const conn = this.getConnection();

    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      const res = await conn
        .insertInto(table)
        .values(chunk)
        .returningAll()
        .execute();
      results.push(...res);
    }
    return results;
  }

  async update(
    table: string,
    data: unknown,
    conditions: DBConditionType[],
  ): Promise<any> {
    const conn = this.getConnection();
    let qb = conn.updateTable(table).set(data as any);
    qb = this.buildQuery(conditions, qb);
    return qb.returningAll().execute();
  }

  // ------------------------------------------------------------------
  // Manual transaction support
  // ------------------------------------------------------------------

  async setMode(mode: DbAdapterMode): Promise<void> {
    this.mode = mode;
  }

  async startTransaction(): Promise<void> {
    if (this.mode === DbAdapterMode.TRANSACTION) return;

    // Reserve a dedicated connection so all statements run on the same socket.
    this.reservedConn = await this.sql.reserve();

    try {
      await this.reservedConn.unsafe("BEGIN");
    } catch (e) {
      this.reservedConn.release();
      this.reservedConn = null;
      throw e;
    }

    // Wrap the reserved connection in its own Kysely instance.
    // We pass a thin SQL-like object so BunSqlDriver can call .unsafe() on it.
    const reservedSql = this.reservedConn as unknown as SQL;
    this.transactionDb = new Kysely<any>({
      dialect: new BunSqlPostgresDialect(reservedSql),
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

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Connection string helpers (mirrors the original extractPgConnectionInfo)
// ---------------------------------------------------------------------------

export function buildPgUrl(connection: Connection): string {
  const { username, password, host, port, database } = connection;
  return `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

export function extractPgConnectionInfo(
  config: any,
  appConfigs: Map<string, string>,
  pgUrlParser: (url: string) => Connection | null,
) {
  if (config.source === "url") {
    config.url = config.url.startsWith("cfg:")
      ? (appConfigs.get(config.url.slice(4)) ?? "")
      : config.url;
    const result = pgUrlParser(config.url);
    if (result === null) return null;
    return {
      host: result.host,
      port: result.port,
      database: result.database,
      username: result.username,
      password: result.password,
      ssl: result.ssl === true,
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
