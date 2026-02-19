import { CompiledQuery, Kysely, PostgresDialect, sql } from "kysely";
import { Pool, PoolClient } from "pg";
import { Connection, DbAdapterMode, DBConditionType, IDbAdapter } from ".";
import { JsVM } from "@fluxify/lib";

export class PostgresAdapter implements IDbAdapter {
  private mode: DbAdapterMode = DbAdapterMode.NORMAL;
  private transaction: Kysely<any> | null = null;
  private trxClient: PoolClient | null = null;
  private readonly HARD_LIMIT = 1000;

  constructor(
    private readonly db: Kysely<any>,
    private readonly pool: Pool,
    private readonly vm: JsVM,
  ) {}

  public static async testConnection(connection: Connection) {
    const pool = new Pool({
      host: connection.host,
      port: Number(connection.port),
      user: connection.username,
      password: connection.password,
      database: connection.database,
      ssl: connection.ssl,
    });
    try {
      const client = await pool.connect();
      const result = await client.query("SELECT 1 as test");
      client.release();
      return { success: result.rows[0].test == 1 };
    } catch (error: any) {
      return { success: false, error };
    } finally {
      await pool.end();
    }
  }

  async raw(query: string | unknown, params?: any[]): Promise<any> {
    if (typeof query !== "string")
      throw new Error("raw function accepts only string queries.");
    const conn = this.getConnection();
    const result = await conn.executeQuery(
      CompiledQuery.raw(query as string, params || []),
    );
    return result;
  }

  async getAll(
    table: string,
    conditions: DBConditionType[],
    limit: number = this.HARD_LIMIT,
    offset: number = 0,
    sort: { attribute: string; direction: "asc" | "desc" },
  ): Promise<unknown[]> {
    const conn = this.getConnection();
    let queryBuilder = conn.selectFrom(table);
    queryBuilder = this.buildQuery(conditions, queryBuilder);
    const l = limit < 0 || limit > this.HARD_LIMIT ? this.HARD_LIMIT : limit!;

    // Use dynamic generic type via any to bypass schema check
    const data = await queryBuilder
      .selectAll()
      .limit(l)
      .offset(offset)
      .orderBy(sort.attribute, sort.direction)
      .execute();
    return data;
  }

  async getSingle(
    table: string,
    conditions: DBConditionType[],
  ): Promise<unknown | null> {
    const conn = this.getConnection();
    let queryBuilder = conn.selectFrom(table);
    queryBuilder = this.buildQuery(conditions, queryBuilder);
    const result = await queryBuilder.selectAll().executeTakeFirst();
    return result || null;
  }

  async delete(table: string, conditions: DBConditionType[]): Promise<boolean> {
    const conn = this.getConnection();
    let queryBuilder = conn.deleteFrom(table);
    queryBuilder = this.buildQuery(conditions, queryBuilder);
    // limit(1) on PG is typically ignored or ineffective, Kysely PG dialect doesn't support limit on delete.
    const result = await queryBuilder.execute();
    return Number(result[0].numDeletedRows) > 0;
  }

  async insert(table: string, data: unknown): Promise<any> {
    const conn = this.getConnection();
    return await conn
      .insertInto(table)
      .values(data as any)
      .returningAll()
      .execute();
  }

  async insertBulk(table: string, data: any[]): Promise<any> {
    // Emulate batchInsert
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
    let queryBuilder = conn.updateTable(table).set(data as any);
    queryBuilder = this.buildQuery(conditions, queryBuilder);
    return await queryBuilder.returningAll().execute();
  }

  async setMode(mode: DbAdapterMode): Promise<void> {
    // This is called by start/commit/rollback internally mostly
    // But implementation logic is mainly in start/commit/rollback
    this.mode = mode;
  }

  async startTransaction() {
    if (this.mode === DbAdapterMode.TRANSACTION) return;

    // Secure a client for the transaction
    this.trxClient = await this.pool.connect();
    try {
      await this.trxClient.query("BEGIN");
    } catch (e) {
      this.trxClient.release();
      this.trxClient = null;
      throw e;
    }

    // Create a generic Kysely instance that uses ONLY this client
    this.transaction = new Kysely<any>({
      dialect: new PostgresDialect({
        pool: {
          connect: async () => this.trxClient!,
          end: async () => {}, // prevent closing the client via Kysely
          totalCount: 1,
          idleCount: 0,
          waitingCount: 0,
          on: () => {},
          removeListener: () => {},
          emit: () => false,
        } as any, // Mock pool
      }),
    });

    await this.setMode(DbAdapterMode.TRANSACTION);
  }

  async commitTransaction() {
    if (this.mode !== DbAdapterMode.TRANSACTION || !this.trxClient)
      throw new Error("db adapter is not in transaction mode");

    try {
      await this.trxClient.query("COMMIT");
    } finally {
      if (this.transaction) {
        await this.transaction.destroy(); // cleanup kysely instance
      }
      this.trxClient.release();
      this.trxClient = null;
      this.transaction = null;
      await this.setMode(DbAdapterMode.NORMAL);
    }
  }

  async rollbackTransaction() {
    if (this.mode !== DbAdapterMode.TRANSACTION || !this.trxClient)
      throw new Error("db adapter is not in transaction mode");

    try {
      await this.trxClient.query("ROLLBACK");
    } finally {
      if (this.transaction) {
        await this.transaction.destroy();
      }
      this.trxClient.release();
      this.trxClient = null;
      this.transaction = null;
      await this.setMode(DbAdapterMode.NORMAL);
    }
  }

  private buildQuery(conditions: DBConditionType[], builder: any) {
    for (let condition of conditions) {
      const operator = this.getNativeOperator(condition.operator);
      const value = condition.value;

      // Kysely uses 'is' for null check if explicitly needed, but standard SQL '=' works for values.
      // Assuming standard operators.
      if (condition.chain == "or") {
        builder = builder.orWhere(condition.attribute, operator, value);
      } else {
        builder = builder.where(condition.attribute, operator, value);
      }
    }
    return builder;
  }

  private getNativeOperator(
    operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte",
  ) {
    if (operator == "eq") return "=";
    else if (operator == "neq") return "<>";
    else if (operator == "gt") return ">";
    else if (operator == "gte") return ">=";
    else if (operator == "lt") return "<";
    else if (operator == "lte") return "<=";
    else return "=";
  }

  private getConnection() {
    if (this.mode === DbAdapterMode.TRANSACTION && this.transaction) {
      return this.transaction;
    }
    return this.db;
  }
}

export function extractPgConnectionInfo(
  config: any,
  appConfigs: Map<string, string>,
  pgUrlParser: (url: string) => Connection | null,
) {
  if (config.source === "url") {
    config.url = config.url.startsWith("cfg:")
      ? appConfigs.get(config.url.slice(4)) || ""
      : config.url;
    const result = pgUrlParser(config.url);
    if (result === null) {
      return null;
    }
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
    if (value.startsWith("cfg:")) {
      config[key] = appConfigs.get(value.slice(4)) || "";
    } else {
      config[key] = value;
    }
  }
  return config;
}
