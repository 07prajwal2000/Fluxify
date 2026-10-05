import { describe, expect, it, spyOn } from "bun:test";
import { Kysely, MysqlDialect } from "kysely";
import { MySqlAdapter } from "./mySqlAdapter";
import { PostgresAdapter } from "./postgresAdapter";

type Sent = { sql: string; params: unknown[] };

/** a pool whose driver answers every query with no rows and keeps what it was sent */
function postgresPool() {
	const sent: Sent[] = [];
	const driver = {
		unsafe: async (sql: string, params: unknown[]) => (sent.push({ sql, params }), []),
	};
	const db = PostgresAdapter.createKysely(driver as never);
	return { sent, db, adapter: () => new PostgresAdapter(db, driver as never) as any };
}

function mysqlPool() {
	const sent: Sent[] = [];
	const conn = {
		query: (sql: string, params: unknown[], done: Function) => (sent.push({ sql, params }), done(null, [])),
		release() {},
	};
	const pool = { getConnection: (done: Function) => done(null, conn) };
	const db = new Kysely<any>({ dialect: new MysqlDialect({ pool: pool as never }) });
	return { sent, db, adapter: () => new MySqlAdapter(db, pool as never) as any };
}

const c = (attribute: unknown, operator: string, value?: unknown, chain = "and") =>
	({ attribute, operator, value, chain }) as any;
const all = (conditions: unknown[], options?: object, limit: number | null = 20, offset = 0) =>
	(a: any) => a.getAll("t", conditions, limit, offset, [{ attribute: "name", direction: "asc" }], options);

// each read runs after the ones above it on one pool; `hit` says it should reuse saved SQL
const reads: [string, (a: any) => Promise<unknown>, boolean][] = [
	["eq", all([c("name", "eq", "a")]), false],
	["eq, another value", all([c("name", "eq", "b")], undefined, 5, 10), true],
	["eq null is a null check", all([c("name", "eq", null)]), false],
	["undefined skips the condition", all([c("name", "eq", undefined)]), false],
	["no limit", all([c("name", "eq", "a")], undefined, null, 3), false],
	["in", all([c("id", "in", [1, 2, 3])]), false],
	["in, same length", all([c("id", "in", [4, 5, 6])]), true],
	["in, comma text of that length", all([c("id", "in", "7, 8, 9")]), true],
	["in, shorter list", all([c("id", "in", [7])]), false],
	["in, empty list", all([c("id", "in", [])]), false],
	["between", all([c("age", "between", [1, 5])]), false],
	["contains escapes % and _", all([c("name", "contains", "50%_off")]), false],
	["contains, another value", all([c("name", "contains", "x_y")]), true],
	["starts_with", all([c("name", "starts_with", "a")]), false],
	["JSON path against a number", all([c("profile.age", "gt", 5)]), false],
	["JSON path against numeric text", all([c("profile.age", "gt", "6")]), true],
	["JSON path against text", all([c("profile.age", "gt", "x")]), false],
	["literal attribute vs column", all([c({ kind: "literal", value: 18 }, "lte", { kind: "column", value: "age" })]), false],
	["literal attribute, another value", all([c({ kind: "literal", value: 21 }, "lte", { kind: "column", value: "age" })]), true],
	["column on the right", all([c("a", "eq", { kind: "column", value: "b" })]), false],
	["custom SQL", all([{ operator: "raw", chain: "and", raw: { strings: ["age > ", ""], values: [3] } }]), false],
	["custom SQL, another value", all([{ operator: "raw", chain: "and", raw: { strings: ["age > ", ""], values: [9] } }]), true],
	["group with or", all([c("a", "eq", 1), { chain: "or", group: [c("b", "eq", 2), c("c", "is_null")] }]), false],
	["group with or, other values", all([c("a", "eq", 3), { chain: "or", group: [c("b", "eq", 4), c("c", "is_null")] }]), true],
	["join", all([c("t.a", "eq", 1)], { joins: [{ table: "u", on: [c("u.t_id", "eq", { kind: "column", value: "t.id" }), c("u.x", "eq", "y")] }] }), false],
	["join, other values", all([c("t.a", "eq", 2)], { joins: [{ table: "u", on: [c("u.t_id", "eq", { kind: "column", value: "t.id" }), c("u.x", "eq", "z")] }] }), true],
	["single", (a) => a.getSingle("t", [c("id", "eq", 1)]), false],
	["single strict", (a) => a.getSingle("t", [c("id", "eq", 2)], { strict: true }), true],
	["count", (a) => a.count("t", [c("id", "gt", 1)]), false],
	["count, another value", (a) => a.count("t", [c("id", "gt", 2)]), true],
];

describe.each([
	["PostgresAdapter", PostgresAdapter, postgresPool],
	["MySqlAdapter", MySqlAdapter, mysqlPool],
] as const)("%s saved read SQL (#408)", (_, Adapter, newPool) => {
	it("sends exactly what a fresh build sends, and builds once per shape", async () => {
		const raw = spyOn(Adapter.prototype, "raw").mockResolvedValue([{ column_name: "id" }]);
		try {
			const pool = newPool();
			const built = spyOn(pool.db, "selectFrom");
			for (const [label, read, hit] of reads) {
				const before = built.mock.calls.length;
				await read(pool.adapter());
				const fresh = newPool();
				await read(fresh.adapter());
				expect({ label, ...pool.sent.at(-1) }).toEqual({ label, ...fresh.sent.at(-1)! });
				expect({ label, built: built.mock.calls.length > before }).toEqual({ label, built: !hit });
			}
		} finally {
			raw.mockRestore();
		}
	});

	it("still refuses a bad condition with the builder's error", async () => {
		const { adapter } = newPool();
		await expect(all([c("id", "in", [1, null])])(adapter())).rejects.toThrow("got a null in its list");
		await expect(all([c("id", "in", [1, null])])(adapter())).rejects.toThrow("got a null in its list");
	});
});

it("reads inside a Postgres transaction on the transaction's own connection", async () => {
	const onPool: string[] = [];
	const inTransaction: string[] = [];
	const reserved = { unsafe: async (sql: string) => (inTransaction.push(sql), []), release() {} };
	const driver = {
		unsafe: async (sql: string) => (onPool.push(sql), []),
		reserve: async () => reserved,
	};
	const adapter = new PostgresAdapter(PostgresAdapter.createKysely(driver as never), driver as never);
	const count = 'select count(*) as "count" from "t"';
	await adapter.count("t", []);
	await adapter.startTransaction();
	await adapter.count("t", []); // saved SQL by now
	await adapter.commitTransaction();
	await adapter.count("t", []);
	expect(onPool).toEqual([count, count]);
	expect(inTransaction).toEqual(["BEGIN", count, "COMMIT"]);
});
