import type { Db } from "mongodb";
import { mongoTypeOf } from "./mongoFilter";

/**
 * Schema details for the AI agent (#652): names only, or full detail for the
 * named tables. Never row data — Mongo samples documents but returns only the
 * inferred field types.
 */
export type SchemaDetails =
	| { tables: string[] }
	| { tables: TableDetail[] }
	| { collections: string[] }
	| { collections: CollectionDetail[] };

export type TableDetail = {
	table: string;
	columns: { name: string; type: string; nullable: boolean; default: string | null }[];
	primaryKey: string[];
	foreignKeys: { name: string; definition: string }[];
	indexes: { name: string; definition: string }[];
};

export type CollectionDetail = {
	collection: string;
	/** inferred from up to MONGO_SAMPLE documents; a field missing from some is still listed */
	fields: { name: string; type: string }[];
	indexes: { name: string; definition: string }[];
};

export type SqlRun = (sql: string, params: unknown[]) => Promise<Record<string, any>[]>;

export const MONGO_SAMPLE = 20;

const PG = {
	list: `SELECT table_schema AS s, table_name AS t FROM information_schema.tables
		WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2`,
	exists: `SELECT to_regclass($1::text) IS NOT NULL AS ok`,
	columns: `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
		NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS "default"
		FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE a.attrelid = to_regclass($1::text) AND a.attnum > 0 AND NOT a.attisdropped
		ORDER BY a.attnum`,
	primaryKey: `SELECT a.attname AS name FROM pg_index i
		JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
		WHERE i.indrelid = to_regclass($1::text) AND i.indisprimary`,
	foreignKeys: `SELECT conname AS name, pg_get_constraintdef(oid) AS definition FROM pg_constraint
		WHERE conrelid = to_regclass($1::text) AND contype = 'f' ORDER BY 1`,
	indexes: `SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS definition
		FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
		WHERE i.indrelid = to_regclass($1::text) ORDER BY 1`,
};

const MY = {
	list: `SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY 1`,
	columns: `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE = 'YES' AS nullable,
		COLUMN_DEFAULT AS \`default\` FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
	primaryKey: `SELECT COLUMN_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
		ORDER BY ORDINAL_POSITION`,
	foreignKeys: `SELECT CONSTRAINT_NAME AS name, COLUMN_NAME AS col,
		REFERENCED_TABLE_NAME AS ref_table, REFERENCED_COLUMN_NAME AS ref_col
		FROM information_schema.KEY_COLUMN_USAGE
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
		ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
	indexes: `SELECT INDEX_NAME AS name, MAX(NON_UNIQUE) AS non_unique,
		GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? GROUP BY INDEX_NAME ORDER BY 1`,
};

const unknown = (name: string) => new Error(`Unknown table "${name}"`);

export async function describeSql(
	dialect: "postgres" | "mysql",
	run: SqlRun,
	tables?: string[],
): Promise<SchemaDetails> {
	if (!tables?.length) {
		if (dialect === "mysql") return { tables: (await run(MY.list, [])).map((r) => r.t) };
		// public tables by bare name, others as schema.table (what to_regclass takes back)
		const rows = await run(PG.list, []);
		return { tables: rows.map((r) => (r.s === "public" ? r.t : `${r.s}.${r.t}`)) };
	}
	const out: TableDetail[] = [];
	for (const table of tables) {
		if (dialect === "postgres") {
			// ponytail: to_regclass folds unquoted names to lower case; quote mixed-case names ("Users")
			if (!(await run(PG.exists, [table]))[0]?.ok) throw unknown(table);
			out.push({
				table,
				columns: (await run(PG.columns, [table])).map(column),
				primaryKey: (await run(PG.primaryKey, [table])).map((r) => r.name),
				foreignKeys: (await run(PG.foreignKeys, [table])).map(named),
				indexes: (await run(PG.indexes, [table])).map(named),
			});
			continue;
		}
		const columns = await run(MY.columns, [table]);
		if (!columns.length) throw unknown(table);
		const fks = new Map<string, { cols: string[]; ref: string; refCols: string[] }>();
		for (const r of await run(MY.foreignKeys, [table])) {
			const fk = fks.get(r.name) ?? {
				cols: [] as string[],
				ref: r.ref_table,
				refCols: [] as string[],
			};
			fk.cols.push(r.col);
			fk.refCols.push(r.ref_col);
			fks.set(r.name, fk);
		}
		out.push({
			table,
			columns: columns.map(column),
			primaryKey: (await run(MY.primaryKey, [table])).map((r) => r.name),
			foreignKeys: [...fks].map(([name, f]) => ({
				name,
				definition: `FOREIGN KEY (${f.cols.join(", ")}) REFERENCES ${f.ref}(${f.refCols.join(", ")})`,
			})),
			indexes: (await run(MY.indexes, [table])).map((r) => ({
				name: r.name,
				definition: `${Number(r.non_unique) ? "" : "UNIQUE "}(${String(r.cols).split(",").join(", ")})`,
			})),
		});
	}
	return { tables: out };
}

const column = (r: Record<string, any>) => ({
	name: r.name,
	type: r.type,
	nullable: !!Number(r.nullable),
	default: r.default ?? null,
});
const named = (r: Record<string, any>) => ({ name: r.name, definition: r.definition });

export async function describeMongo(db: Db, collections?: string[]): Promise<SchemaDetails> {
	if (!collections?.length) {
		const all = await db.listCollections({}, { nameOnly: true }).toArray();
		return { collections: all.map((c) => c.name).sort() };
	}
	const out: CollectionDetail[] = [];
	for (const name of collections) {
		if (!(await db.listCollections({ name }, { nameOnly: true }).toArray()).length) {
			throw new Error(`Unknown collection "${name}"`);
		}
		const coll = db.collection(name);
		const docs = await coll.find({}, { limit: MONGO_SAMPLE, maxTimeMS: 5000 }).toArray();
		const types = new Map<string, Set<string>>();
		for (const doc of docs) {
			for (const [key, value] of Object.entries(doc)) {
				if (!types.has(key)) types.set(key, new Set());
				types.get(key)!.add(mongoTypeOf(value));
			}
		}
		const indexes = await coll.indexes();
		out.push({
			collection: name,
			// only names and type names leave here, never a value
			fields: [...types].map(([field, kinds]) => ({
				name: field,
				type: [...kinds].sort().join(" | "),
			})),
			indexes: indexes.map((i) => ({
				name: String(i.name),
				definition: `${i.unique ? "UNIQUE " : ""}${JSON.stringify(i.key)}`,
			})),
		});
	}
	return { collections: out };
}
