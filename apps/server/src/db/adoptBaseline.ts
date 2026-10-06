import { logger } from "@fluxify/common";
import type { SQL } from "bun";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { join } from "path";

// The parts of a drizzle-kit (v7) snapshot the baseline uses. The baseline is
// frozen, so this only has to cover what `meta/0000_snapshot.json` contains.
// ponytail: no identity/generated columns, sequences, views or policies — add
// them here if a future re-baseline uses them.
type Column = {
	name: string;
	type: string;
	typeSchema?: string;
	primaryKey: boolean;
	notNull: boolean;
	default?: unknown;
};
type Index = {
	name: string;
	columns: { expression: string; isExpression: boolean }[];
	isUnique: boolean;
	method: string;
	where?: string;
};
type Table = {
	name: string;
	schema: string;
	columns: Record<string, Column>;
	indexes: Record<string, Index>;
	foreignKeys: Record<
		string,
		{
			name: string;
			tableTo: string;
			schemaTo?: string;
			columnsFrom: string[];
			columnsTo: string[];
			onDelete?: string;
			onUpdate?: string;
		}
	>;
	compositePrimaryKeys: Record<string, { name: string; columns: string[] }>;
	uniqueConstraints: Record<string, { name: string; columns: string[]; nullsNotDistinct: boolean }>;
	checkConstraints: Record<string, { name: string; value: string }>;
};
export type Snapshot = {
	tables: Record<string, Table>;
	enums: Record<string, { name: string; schema: string; values: string[] }>;
};

const q = (name: string) => `"${name}"`;
const cols = (names: string[]) => names.map(q).join(", ");
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * Adds a constraint unless the catalog already has one matching `match`.
 * `conname = '<long name>'` still matches a name Postgres cut to 63 bytes: the
 * literal is cast to `name`, which truncates it the same way.
 */
function guarded(table: string, match: string, add: string) {
	return `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ${literal(table)}::regclass AND ${match}) THEN ALTER TABLE ${table} ADD ${add}; END IF; END $$`;
}

function tableStatements(t: Table) {
	const ref = `${q(t.schema || "public")}.${q(t.name)}`;
	const byName = (name: string) => `conname = ${literal(name)}`;
	const columns = Object.values(t.columns).map((c) => {
		const type = c.typeSchema ? `${q(c.typeSchema)}.${q(c.type)}` : c.type;
		const pk = c.primaryKey ? " PRIMARY KEY" : "";
		const def = c.default === undefined ? "" : ` DEFAULT ${c.default}`;
		return `ALTER TABLE ${ref} ADD COLUMN IF NOT EXISTS ${q(c.name)} ${type}${pk}${def}${c.notNull ? " NOT NULL" : ""}`;
	});
	const constraints = [
		// Any primary key counts: a table can only have one, whatever its name.
		...Object.values(t.compositePrimaryKeys).map((pk) =>
			guarded(ref, "contype = 'p'", `CONSTRAINT ${q(pk.name)} PRIMARY KEY(${cols(pk.columns)})`),
		),
		...Object.values(t.uniqueConstraints).map((u) =>
			guarded(
				ref,
				byName(u.name),
				`CONSTRAINT ${q(u.name)} UNIQUE${u.nullsNotDistinct ? " NULLS NOT DISTINCT" : ""}(${cols(u.columns)})`,
			),
		),
		...Object.values(t.checkConstraints).map((c) =>
			guarded(ref, byName(c.name), `CONSTRAINT ${q(c.name)} CHECK (${c.value})`),
		),
	];
	return { create: [`CREATE TABLE IF NOT EXISTS ${ref} ()`, ...columns, ...constraints], ref };
}

function foreignKeys(t: Table, ref: string) {
	return Object.values(t.foreignKeys).map((fk) =>
		guarded(
			ref,
			`conname = ${literal(fk.name)}`,
			`CONSTRAINT ${q(fk.name)} FOREIGN KEY (${cols(fk.columnsFrom)}) REFERENCES ${q(fk.schemaTo || "public")}.${q(fk.tableTo)}(${cols(fk.columnsTo)}) ON DELETE ${fk.onDelete ?? "no action"} ON UPDATE ${fk.onUpdate ?? "no action"}`,
		),
	);
}

function indexes(t: Table, ref: string) {
	return Object.values(t.indexes).map((i) => {
		const on = i.columns.map((c) => (c.isExpression ? c.expression : q(c.expression))).join(",");
		const where = i.where ? ` WHERE ${i.where}` : "";
		return `CREATE ${i.isUnique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${q(i.name)} ON ${ref} USING ${i.method} (${on})${where}`;
	});
}

/**
 * Idempotent SQL that brings any older Fluxify database up to the baseline
 * snapshot: missing types, tables, columns, constraints and indexes are
 * created, anything already there is left alone. It cannot change a column
 * whose type or constraints changed in place.
 *
 * `enums` runs on its own, before `schema`: Postgres refuses to use an enum
 * value added in the same transaction (55P04), and a column default may.
 */
export function adoptSql(snapshot: Snapshot) {
	const enums = Object.values(snapshot.enums).flatMap((e) => {
		const ref = `${q(e.schema)}.${q(e.name)}`;
		return [
			`DO $$ BEGIN CREATE TYPE ${ref} AS ENUM(${e.values.map(literal).join(", ")}); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
			...e.values.map((v) => `ALTER TYPE ${ref} ADD VALUE IF NOT EXISTS ${literal(v)}`),
		];
	});
	const tables = Object.values(snapshot.tables).map((t) => ({ t, ...tableStatements(t) }));
	// Every table first, so a foreign key never points at one not created yet.
	const schema = [
		...tables.flatMap((x) => x.create),
		...tables.flatMap((x) => foreignKeys(x.t, x.ref)),
		...tables.flatMap((x) => indexes(x.t, x.ref)),
	];
	return { enums, schema };
}

/**
 * A database installed before versioned migrations has tables but no rows in
 * Drizzle's migrations table. Bring it up to the baseline and record the
 * baseline as applied, exactly as the migrator would, so the migrator only runs
 * what came after it. A fresh database is left to the migrator.
 */
export async function adoptExistingDatabase(client: SQL, migrationsFolder: string) {
	// Same DDL the migrator runs before reading the table.
	await client`CREATE SCHEMA IF NOT EXISTS "drizzle"`;
	await client`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
	const [state] = await client`
		SELECT EXISTS (SELECT 1 FROM "drizzle"."__drizzle_migrations") AS "tracked",
			EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public') AS "hasTables"`;
	if (state.tracked || !state.hasTables) return;

	logger.info("existing database without migration history: bringing it up to the baseline");
	const snapshot: Snapshot = await Bun.file(
		join(migrationsFolder, "meta/0000_snapshot.json"),
	).json();
	const { enums, schema } = adoptSql(snapshot);
	const [baseline] = readMigrationFiles({ migrationsFolder });
	for (const stmt of enums) await client.unsafe(stmt);
	await client.begin(async (tx) => {
		for (const stmt of schema) await tx.unsafe(stmt);
		await tx`INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES (${baseline!.hash}, ${baseline!.folderMillis})`;
	});
}
