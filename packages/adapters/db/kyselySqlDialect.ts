/**
 * bun-sql-dialect.ts
 *
 * A Kysely dialect that wraps Bun's native SQL client (Bun.SQL).
 * Works with both PostgreSQL and MySQL — the dialect variant is
 * determined by which Kysely adapter/compiler you pair it with.
 *
 * Usage:
 *   import { BunSqlPostgresDialect } from './bun-sql-dialect'
 *   import { BunSqlMysqlDialect }    from './bun-sql-dialect'
 */

import { SQL } from "bun";
import {
  CompiledQuery,
  DatabaseConnection,
  DatabaseIntrospector,
  Dialect,
  DialectAdapter,
  Driver,
  Kysely,
  MysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  QueryCompiler,
  QueryResult,
} from "kysely";

// ---------------------------------------------------------------------------
// Shared connection wrapper
// ---------------------------------------------------------------------------

class BunSqlConnection implements DatabaseConnection {
  constructor(
    // Either a reserved connection (for manual transactions) or the pool itself.
    private readonly client: SQL | Awaited<ReturnType<SQL["reserve"]>>,
  ) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const { sql, parameters } = compiledQuery;

    // `unsafe` runs a raw SQL string with positional params.
    // Bun.SQL supports both $1 (pg) and ? (mysql) placeholders natively.
    const rows = await (this.client as any).unsafe(sql, parameters as any[]);

    // For INSERT/UPDATE/DELETE Bun returns metadata on the result array.
    const numAffectedRows =
      (rows as any)?.count !== undefined
        ? BigInt((rows as any).count)
        : undefined;

    const rawInsertId = (rows as any)?.lastInsertRowid;

    return {
      rows: Array.isArray(rows) ? (rows as unknown as R[]) : [],
      numAffectedRows,
      // Only set insertId when the value is a non-null number or bigint.
      // Postgres doesn't have this field; SQLite/MySQL return it after inserts.
      insertId:
        rawInsertId != null &&
        (typeof rawInsertId === "number" || typeof rawInsertId === "bigint")
          ? BigInt(rawInsertId)
          : undefined,
    };
  }

  // Bun.SQL doesn't expose a row-by-row streaming API via `unsafe`, so we
  // fall back to fetching all rows and yielding them one at a time.
  async *streamQuery<R>(
    compiledQuery: CompiledQuery,
  ): AsyncIterableIterator<QueryResult<R>> {
    const result = await this.executeQuery<R>(compiledQuery);
    for (const row of result.rows) {
      yield { rows: [row] };
    }
  }
}

// ---------------------------------------------------------------------------
// Shared driver
// ---------------------------------------------------------------------------

class BunSqlDriver implements Driver {
  // For manual (non-callback) transactions we keep a reserved connection.
  private reservedConn: Awaited<ReturnType<SQL["reserve"]>> | null = null;
  private inTransaction = false;

  constructor(private readonly sql: SQL) {}

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    if (this.inTransaction && this.reservedConn) {
      return new BunSqlConnection(this.reservedConn);
    }
    // For normal queries just hand back the pool — Bun handles pooling.
    return new BunSqlConnection(this.sql);
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    // Reserve a dedicated connection from the pool so BEGIN/COMMIT/ROLLBACK
    // all run on the same physical connection.
    this.reservedConn = await this.sql.reserve();
    this.inTransaction = true;
    await this.reservedConn.unsafe("BEGIN");
  }

  async commitTransaction(_connection: DatabaseConnection): Promise<void> {
    if (!this.reservedConn) throw new Error("No active transaction");
    await this.reservedConn.unsafe("COMMIT");
    this.reservedConn.release();
    this.reservedConn = null;
    this.inTransaction = false;
  }

  async rollbackTransaction(_connection: DatabaseConnection): Promise<void> {
    if (!this.reservedConn) throw new Error("No active transaction");
    try {
      await this.reservedConn.unsafe("ROLLBACK");
    } finally {
      this.reservedConn.release();
      this.reservedConn = null;
      this.inTransaction = false;
    }
  }

  async releaseConnection(_connection: DatabaseConnection): Promise<void> {
    // Bun manages the pool; nothing to do for normal queries.
  }

  async destroy(): Promise<void> {
    await this.sql.close();
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL dialect
// ---------------------------------------------------------------------------

export class BunSqlPostgresDialect implements Dialect {
  constructor(private readonly sql: SQL) {}

  createAdapter(): DialectAdapter {
    return new PostgresAdapter();
  }

  createDriver(): Driver {
    return new BunSqlDriver(this.sql);
  }

  createQueryCompiler(): QueryCompiler {
    return new PostgresQueryCompiler();
  }

  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new PostgresIntrospector(db);
  }
}

// ---------------------------------------------------------------------------
// MySQL dialect
// ---------------------------------------------------------------------------

export class BunSqlMysqlDialect implements Dialect {
  constructor(private readonly sql: SQL) {}

  createAdapter(): DialectAdapter {
    return new MysqlAdapter();
  }

  createDriver(): Driver {
    return new BunSqlDriver(this.sql);
  }

  createQueryCompiler(): QueryCompiler {
    return new MysqlQueryCompiler();
  }

  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new MysqlIntrospector(db);
  }
}
