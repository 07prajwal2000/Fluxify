import { describe, expect, it } from "bun:test";
import { describeMongo, describeSql, MONGO_SAMPLE, type SqlRun } from "./describe";

/** answers each query by the first matching fragment */
const fakeRun = (answers: [string, Record<string, any>[]][]) => {
	const calls: string[] = [];
	const run: SqlRun = async (q, p) => {
		calls.push(`${q.trim().slice(0, 30)}|${p.join(",")}`);
		return answers.find(([frag]) => q.includes(frag))?.[1] ?? [];
	};
	return { run, calls };
};

describe("describeSql", () => {
	it("postgres: names only without tables, schema-qualified outside public", async () => {
		const { run } = fakeRun([
			["information_schema.tables", [{ s: "public", t: "users" }, { s: "audit", t: "log" }]],
		]);
		expect(await describeSql("postgres", run)).toEqual({ tables: ["users", "audit.log"] });
	});

	it("postgres: columns, keys and indexes for the named tables", async () => {
		const { run, calls } = fakeRun([
			["IS NOT NULL AS ok", [{ ok: true }]],
			["format_type", [{ name: "id", type: "integer", nullable: false, default: "nextval('s')" }, { name: "org_id", type: "uuid", nullable: true, default: null }]],
			["indisprimary", [{ name: "id" }]],
			["contype = 'f'", [{ name: "users_org_fk", definition: "FOREIGN KEY (org_id) REFERENCES orgs(id)" }]],
			["pg_get_indexdef", [{ name: "users_pkey", definition: "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)" }]],
		]);
		expect(await describeSql("postgres", run, ["users"])).toEqual({
			tables: [
				{
					table: "users",
					columns: [
						{ name: "id", type: "integer", nullable: false, default: "nextval('s')" },
						{ name: "org_id", type: "uuid", nullable: true, default: null },
					],
					primaryKey: ["id"],
					foreignKeys: [{ name: "users_org_fk", definition: "FOREIGN KEY (org_id) REFERENCES orgs(id)" }],
					indexes: [{ name: "users_pkey", definition: "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)" }],
				},
			],
		});
		// only catalog queries, never the table itself
		expect(calls.every((c) => !/FROM users/i.test(c))).toBe(true);
	});

	it("postgres: unknown table is a readable error", async () => {
		const { run } = fakeRun([["IS NOT NULL AS ok", [{ ok: false }]]]);
		await expect(describeSql("postgres", run, ["nope"])).rejects.toThrow('Unknown table "nope"');
	});

	it("mysql: names, then detail with grouped foreign keys and index uniqueness", async () => {
		const { run } = fakeRun([
			["information_schema.TABLES", [{ t: "orders" }]],
			["COLUMN_TYPE", [{ name: "id", type: "int", nullable: 0, default: null }, { name: "note", type: "varchar(20)", nullable: 1, default: "x" }]],
			["CONSTRAINT_NAME = 'PRIMARY'", [{ name: "id" }]],
			["REFERENCED_TABLE_NAME IS NOT NULL", [{ name: "fk", col: "a", ref_table: "t", ref_col: "x" }, { name: "fk", col: "b", ref_table: "t", ref_col: "y" }]],
			["STATISTICS", [{ name: "PRIMARY", non_unique: 0, cols: "id" }, { name: "by_note", non_unique: 1, cols: "note,id" }]],
		]);
		expect(await describeSql("mysql", run)).toEqual({ tables: ["orders"] });
		const [detail] = ((await describeSql("mysql", run, ["orders"])) as any).tables;
		expect(detail.columns).toEqual([
			{ name: "id", type: "int", nullable: false, default: null },
			{ name: "note", type: "varchar(20)", nullable: true, default: "x" },
		]);
		expect(detail.primaryKey).toEqual(["id"]);
		expect(detail.foreignKeys).toEqual([{ name: "fk", definition: "FOREIGN KEY (a, b) REFERENCES t(x, y)" }]);
		expect(detail.indexes).toEqual([
			{ name: "PRIMARY", definition: "UNIQUE (id)" },
			{ name: "by_note", definition: "(note, id)" },
		]);
	});

	it("mysql: a table with no columns is unknown", async () => {
		await expect(describeSql("mysql", fakeRun([]).run, ["ghost"])).rejects.toThrow('Unknown table "ghost"');
	});
});

describe("describeMongo", () => {
	const SECRET = "hunter2-secret-value";
	const docs = [
		{ _id: "a", email: SECRET, age: 3 },
		{ _id: "b", email: null, tags: ["x"] },
	];
	let findOpts: any;
	const db: any = {
		listCollections: (filter: any) => ({
			toArray: async () => [{ name: "users" }, { name: "orders" }].filter((c) => !filter?.name || c.name === filter.name),
		}),
		collection: () => ({
			find: (_q: unknown, opts: unknown) => {
				findOpts = opts;
				return { toArray: async () => docs };
			},
			indexes: async () => [{ name: "_id_", key: { _id: 1 } }, { name: "email_1", key: { email: 1 }, unique: true }],
		}),
	};

	it("lists collection names without collections", async () => {
		expect(await describeMongo(db)).toEqual({ collections: ["orders", "users"] });
	});

	it("infers field types and indexes, never values", async () => {
		const result = await describeMongo(db, ["users"]);
		expect(findOpts.limit).toBe(MONGO_SAMPLE);
		expect(result).toEqual({
			collections: [
				{
					collection: "users",
					fields: [
						{ name: "_id", type: "string" },
						{ name: "email", type: "null | string" },
						{ name: "age", type: "number" },
						{ name: "tags", type: "array" },
					],
					indexes: [
						{ name: "_id_", definition: '{"_id":1}' },
						{ name: "email_1", definition: 'UNIQUE {"email":1}' },
					],
				},
			],
		});
		expect(JSON.stringify(result)).not.toContain(SECRET);
	});

	it("unknown collection is a readable error", async () => {
		await expect(describeMongo(db, ["ghost"])).rejects.toThrow('Unknown collection "ghost"');
	});
});
