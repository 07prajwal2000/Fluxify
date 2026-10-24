import { normalizeJoin } from "../panel/blocks/db/conditions";

/** The slice of the integration metadata the type needs. */
export type DbMeta = {
	variant?: string;
	tables: { table: string; columns: { name: string; type: string }[] }[];
};

/** What a get-single / get-all block is set to read. */
export type DbReadConfig = {
	tableName: string;
	columns?: unknown;
	joins?: unknown;
};

const ANY_ROW = "{ [key: string]: any }";
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const key = (name: string) => (IDENTIFIER.test(name) ? name : JSON.stringify(name));

const NUMBERS = new Set(["integer", "smallint", "real", "double precision", "oid"]);
const STRINGS = new Set([
	"bigint",
	"numeric",
	"decimal",
	"money",
	"uuid",
	"text",
	"citext",
	"character varying",
	"character",
	"name",
	"interval",
	"inet",
	"cidr",
	"macaddr",
	"xml",
	"time without time zone",
	"time with time zone",
]);
const DATES = new Set(["date", "timestamp without time zone", "timestamp with time zone"]);

/** `information_schema` type names; what each arrives as was read off the real driver. */
function postgresType(type: string): string {
	const t = type.toLowerCase();
	if (NUMBERS.has(t)) return "number";
	if (STRINGS.has(t)) return "string";
	if (DATES.has(t)) return "Date";
	if (t === "boolean") return "boolean";
	if (t === "bytea") return "Uint8Array";
	if (t === "array") return "any[]";
	// json, jsonb, enums, geometry, ...
	return "any";
}

/** `COLUMN_TYPE` names (`int(11)`, `varchar(20)`, `enum('a','b')`). */
function mysqlType(type: string): string {
	const t = type.toLowerCase();
	const base = t.match(/^[a-z]+/)?.[0] ?? "";
	switch (base) {
		case "int":
		case "integer":
		case "tinyint":
		case "smallint":
		case "mediumint":
		case "float":
		case "double":
		case "real":
		case "year":
			return "number";
		// a number while it is safe to be one, a string past 2^53
		case "bigint":
			return "number | string";
		case "decimal":
		case "numeric":
		case "char":
		case "varchar":
		case "tinytext":
		case "text":
		case "mediumtext":
		case "longtext":
		case "time":
		case "set":
			return "string";
		case "enum": {
			const values = [...type.matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
				JSON.stringify(m[1].replaceAll("''", "'")),
			);
			return values.length ? values.join(" | ") : "string";
		}
		case "date":
		case "datetime":
		case "timestamp":
			return "Date";
		case "blob":
		case "tinyblob":
		case "mediumblob":
		case "longblob":
		case "binary":
		case "varbinary":
		case "bit":
			return "Uint8Array";
		default:
			// json, geometry, ...
			return "any";
	}
}

const MONGO: Record<string, string> = {
	string: "string",
	number: "number",
	boolean: "boolean",
	date: "Date",
	objectId: "string",
	array: "any[]",
	object: "any",
	null: "null",
};

/** The introspected type is a sample of what documents hold, joined with ` | `. */
const mongoType = (type: string) =>
	[...new Set(type.split(" | ").map((k) => MONGO[k] ?? "any"))].join(" | ");

/** The TypeScript type a column's value has in a script. */
export function columnType(variant: string | undefined, type: string): string {
	if (variant === "MongoDB") return mongoType(type);
	return variant === "MySQL" ? mysqlType(type) : postgresType(type);
}

type Source = { qualifier: string; columns: Map<string, string>; nullable: boolean };

/** A name as the block stores it, without quotes or a `js:'…'` literal around it. */
const plain = (name: string) =>
	name
		.replace(/^js:/, "")
		.replace(/^['"`]|['"`]$/g, "")
		.trim();

/** A table given as an expression (`js:getQueryParam("t")`) is only known at run time. */
const isExpression = (name: string) =>
	name.startsWith("js:") && !/^js:\s*(['"`])[^'"`]*\1\s*$/.test(name);

function findTable(meta: DbMeta, name: string) {
	const clean = plain(name).toLowerCase();
	if (!clean) return undefined;
	return meta.tables.find((t) => {
		const table = t.table.toLowerCase();
		return table === clean || table.split(".").pop() === clean;
	});
}

function sourceFor(
	meta: DbMeta,
	name: string,
	qualifier: string,
	nullable: boolean,
): Source | null {
	if (isExpression(name)) return null;
	const found = findTable(meta, name);
	if (!found) return null;
	const columns = new Map(found.columns.map((c) => [c.name, columnType(meta.variant, c.type)]));
	return { qualifier: plain(qualifier).toLowerCase(), columns, nullable };
}

const orNull = (type: string, nullable: boolean) =>
	nullable && type !== "any" ? `${type} | null` : type;

/**
 * The shape of one row a get-single / get-all block returns, from the columns
 * the table has and the ones the block picks. Anything it cannot place (a
 * function, a table it cannot see) comes back as `any` or as an open index
 * signature, never as a wrong type.
 */
export function dbRowType(meta: DbMeta | null, config: DbReadConfig): string {
	if (!meta || !config.tableName) return ANY_ROW;
	const joins = (Array.isArray(config.joins) ? config.joins : []).map((raw) =>
		normalizeJoin(raw as Parameters<typeof normalizeJoin>[0]),
	);
	// a join the main table is not on the guaranteed side of
	const mainNullable = joins.some((j) => j.type === "right" || j.type === "full");
	const main = sourceFor(meta, config.tableName, config.tableName, mainNullable);
	if (!main) return ANY_ROW;
	const sources: Source[] = [main];
	for (const join of joins) {
		const joined = sourceFor(
			meta,
			join.table,
			join.alias || join.table,
			join.type === "left" || join.type === "full",
		);
		// a table we cannot see makes `*` and bare names unknowable
		if (!joined) return ANY_ROW;
		sources.push(joined);
	}

	const members = new Map<string, string>();
	let open = false;
	// documents are not uniform: any field may be missing
	const optional = meta.variant === "MongoDB" ? "?" : "";
	const picks = Array.isArray(config.columns) && config.columns.length ? config.columns : ["*"];
	for (const pick of picks) {
		const entry = String(pick).trim();
		const aliased = entry.match(/^(.+?)\s+as\s+(.+)$/i);
		const expression = (aliased ? aliased[1] : entry).trim();
		const alias = aliased ? plain(aliased[2]) : "";
		const [qualifier, column] = expression.includes(".")
			? [
					expression.slice(0, expression.lastIndexOf(".")),
					expression.slice(expression.lastIndexOf(".") + 1),
				]
			: ["", expression];
		const scope = qualifier
			? sources.filter((s) => s.qualifier === plain(qualifier).toLowerCase())
			: sources;
		if (column === "*") {
			if (scope.length === 0) open = true;
			for (const source of scope) {
				for (const [name, type] of source.columns) members.set(name, orNull(type, source.nullable));
			}
			continue;
		}
		const owner = /^[\w$]+$/.test(column) ? scope.find((s) => s.columns.has(column)) : undefined;
		if (owner)
			members.set(alias || column, orNull(owner.columns.get(column) ?? "any", owner.nullable));
		else if (alias) members.set(alias, "any");
		else open = true;
	}
	const lines = [...members].map(([name, type]) => `${key(name)}${optional}: ${type};`);
	if (open) lines.push("[key: string]: any;");
	return lines.length ? `{ ${lines.join(" ")} }` : ANY_ROW;
}

/** `Get Single` hands on the row, or `null` for no match. */
export const singleOutputType = (row: string) => `${row} | null`;

/** `Get All` hands on a list; cursor paging wraps it. */
export const allOutputType = (row: string, paging: unknown) =>
	paging === "cursor" ? `{ rows: (${row})[]; nextCursor: string | null }` : `(${row})[]`;
