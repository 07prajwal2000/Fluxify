import knex, { Knex } from "knex";
import { Connection, DbAdapterMode, DBConditionType, IDbAdapter } from ".";
import { JsVM } from "@fluxify/lib";

export class PostgresAdapter implements IDbAdapter {
  private mode: DbAdapterMode = DbAdapterMode.NORMAL;
  private transaction: Knex.Transaction | null = null;
  private readonly HARD_LIMIT = 1000;

  constructor(private readonly connection: Knex, private readonly vm: JsVM) {}
  public static async testConnection(connection: Connection) {
    const conn = knex({
      client: "pg",
      connection: {
        host: connection.host,
        port: Number(connection.port),
        user: connection.username,
        password: connection.password,
        database: connection.database,
        ssl: connection.ssl,
      },
    });
    try {
      const result = await conn.raw("SELECT 1 as test");
      return { success: result.rows[0].test == 1 };
    } catch (error: any) {
      return { success: false, error };
    } finally {
      conn.destroy();
    }
  }
  async raw(query: string | unknown, params?: any[]): Promise<any> {
    if (typeof query !== "string")
      throw new Error("raw function accepts only string queries.");
    const conn = this.getConnection()!;
    return await conn.raw(query, params ?? []);
  }
  async getAll(
    table: string,
    conditions: DBConditionType[],
    limit: number = this.HARD_LIMIT,
    offset: number = 0,
    sort: { attribute: string; direction: "asc" | "desc" }
  ): Promise<unknown[]> {
    const conn = this.getConnection()!;
    let queryBuilder = conn(table);
    queryBuilder = await this.buildQuery(conditions, queryBuilder);
    const l = limit < 0 || limit > this.HARD_LIMIT ? this.HARD_LIMIT : limit!;
    const data = await queryBuilder
      .limit(l)
      .offset(offset)
      .orderBy(sort.attribute, sort.direction)
      .select("*");
    return data;
  }
  async getSingle(
    table: string,
    conditions: DBConditionType[]
  ): Promise<unknown | null> {
    const conn = this.getConnection()!;
    let queryBuilder = conn(table);
    queryBuilder = await this.buildQuery(conditions, queryBuilder);
    return await queryBuilder.first("*");
  }
  async delete(table: string, conditions: DBConditionType[]): Promise<boolean> {
    const conn = this.getConnection()!;
    let queryBuilder = conn(table);
    queryBuilder = await this.buildQuery(conditions, queryBuilder);
    const result = await queryBuilder.limit(1).delete();
    return result > 0;
  }
  async insert(table: string, data: unknown): Promise<any> {
    const conn = this.getConnection()!;
    return await conn(table).insert(data).returning("*");
  }
  async insertBulk(table: string, data: any[]): Promise<any> {
    const conn = this.getConnection()!;
    return await conn.batchInsert(table, data).returning("*");
  }
  async update(
    table: string,
    data: unknown,
    conditions: DBConditionType[]
  ): Promise<any> {
    const conn = this.getConnection()!;
    let queryBuilder = conn(table);
    queryBuilder = await this.buildQuery(conditions, queryBuilder);
    return await queryBuilder.update(data).returning("*");
  }
  async setMode(mode: DbAdapterMode): Promise<void> {
    if (mode == DbAdapterMode.TRANSACTION) {
      this.transaction = await this.connection.transaction();
    } else {
      this.transaction = null;
    }
    this.mode = mode;
  }
  async startTransaction() {
    await this.setMode(DbAdapterMode.TRANSACTION);
  }
  async commitTransaction() {
    if (this.mode !== DbAdapterMode.TRANSACTION)
      throw new Error("db adapter is not in transaction mode");
    await this.transaction?.commit();
    await this.setMode(DbAdapterMode.NORMAL);
  }
  async rollbackTransaction() {
    if (this.mode !== DbAdapterMode.TRANSACTION)
      throw new Error("db adapter is not in transaction mode");
    await this.transaction?.rollback();
    await this.setMode(DbAdapterMode.NORMAL);
  }
  private async buildQuery(
    conditions: DBConditionType[],
    builder: Knex.QueryBuilder
  ) {
    for (let condition of conditions) {
      const operator = this.getNativeOperator(condition.operator);
      const value =
        typeof condition.value === "string" && condition.value.startsWith("js:")
          ? await this.vm.run(condition.value.slice(3))
          : condition.value;

      if (condition.chain == "or") {
        builder = builder.orWhere(condition.attribute, operator, value);
      } else {
        builder = builder.andWhere(condition.attribute, operator, value);
      }
    }
    return builder;
  }
  private getNativeOperator(
    operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
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
    if (this.mode === DbAdapterMode.TRANSACTION) {
      return this.transaction;
    }
    return this.connection;
  }
}
