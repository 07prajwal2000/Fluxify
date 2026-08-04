import { describe, it, expect } from "bun:test";
import { JsVM } from "@fluxify/lib";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import type { BlockDTOType, EdgeDTOSchemaType } from "../../builderTypes";

/** records every adapter call so the tests can assert what reached knex */
function createDbAdapter(results: Record<string, any> = {}) {
	const calls: { method: string; args: any[] }[] = [];
	const record =
		(method: string) =>
		async (...args: any[]) => {
			calls.push({ method, args });
			return results[method];
		};
	return {
		calls,
		adapter: {
			getSingle: record("getSingle"),
			getAll: record("getAll"),
			insert: record("insert"),
			insertBulk: record("insertBulk"),
			update: record("update"),
			delete: record("delete"),
			raw: record("raw"),
			startTransaction: record("startTransaction"),
			commitTransaction: record("commitTransaction"),
			rollbackTransaction: record("rollbackTransaction"),
		},
	};
}

function createContext(adapter: any) {
	const vars: Record<string, any> = {};
	return {
		vm: new JsVM(vars),
		route: "/db",
		apiId: "api-1",
		projectId: "proj-1",
		vars,
		dbFactory: { getDbAdapter: () => adapter },
		stopper: { timeoutEnd: 0, duration: 10000 },
	} as any;
}

const block = (id: string, type: BlockTypes, data: any = {}): BlockDTOType => ({
	id,
	type,
	data,
	position: { x: 0, y: 0 },
});

const edge = (from: string, to: string, toHandle = "source") => ({
	id: `edge-${from}-${to}-${toHandle}`,
	from,
	to,
	fromHandle: "source",
	toHandle,
});

/** entrypoint -> block under test -> response */
function graphAround(target: BlockDTOType) {
	const blocks = [
		block("in", BlockTypes.entrypoint),
		target,
		block("out", BlockTypes.response, { httpCode: "200" }),
	];
	const edges: EdgeDTOSchemaType = [edge("in", target.id), edge(target.id, "out")];
	return { blocks, edges };
}

async function runAround(target: BlockDTOType, input: any, mock: any) {
	const { blocks, edges } = graphAround(target);
	const { run, source } = compileGraph(blocks, edges);
	const ctx = createContext(mock.adapter);
	const result = await run(ctx, input);
	return { result, ctx, source };
}

describe("compiled db blocks", () => {
	it("compiles where conditions to a plain array, evaluating js operands", async () => {
		const mock = createDbAdapter({ getSingle: { id: 7, name: "ada" } });
		const target = block("db", BlockTypes.db_getsingle, {
			connection: "conn-1",
			tableName: "users",
			conditions: [
				{ attribute: "id", operator: "eq", value: "js:return input.id", chain: "and" },
				{ attribute: "status", operator: "neq", value: "deleted", chain: "and" },
			],
			columns: ["id", "name"],
			joins: [],
		});

		const { result, source } = await runAround(target, { id: 7 }, mock);

		// the conditions are literal JS in the compiled output, not a VM call
		expect(source).not.toContain("ctx.vm");
		expect(mock.calls[0].method).toBe("getSingle");
		expect(mock.calls[0].args[0]).toBe("users");
		expect(mock.calls[0].args[1]).toEqual([
			{ attribute: "id", operator: "eq", value: 7, chain: "and" },
			{ attribute: "status", operator: "neq", value: "deleted", chain: "and" },
		]);
		expect(mock.calls[0].args[2]).toEqual({ joins: [], columns: ["id", "name"] });
		expect(result.output.body).toEqual({ id: 7, name: "ada" });
	});

	it("evaluates js table names, limit and offset for get all", async () => {
		const mock = createDbAdapter({ getAll: [{ id: 1 }] });
		const target = block("db", BlockTypes.db_getall, {
			connection: "conn-1",
			tableName: "js:return 'tenant_' + input.tenant",
			conditions: [],
			limit: "js:return input.limit",
			offset: "not a number",
			sort: { attribute: "id", direction: "desc" },
		});

		const { result } = await runAround(target, { tenant: "acme", limit: 25 }, mock);

		const [table, conditions, limit, offset, sort] = mock.calls[0].args;
		expect(table).toBe("tenant_acme");
		expect(conditions).toEqual([]);
		expect(limit).toBe(25);
		expect(offset).toBe(0); // NaN falls back, same as the interpreted block
		expect(sort).toEqual({ attribute: "id", direction: "desc" });
		expect(result.output.body).toEqual([{ id: 1 }]);
	});

	it("inlines js values inside a literal insert payload", async () => {
		const mock = createDbAdapter({ insert: { id: 99 } });
		const target = block("db", BlockTypes.db_insert, {
			connection: "conn-1",
			tableName: "orders",
			useParam: false,
			data: {
				source: "raw",
				value: {
					total: "js:return input.qty * 10",
					label: "fixed",
					nested: { owner: "js:return input.user" },
					tags: ["a", "js:return input.user"],
				},
			},
		});

		const { source } = await runAround(target, { qty: 4, user: "ada" }, mock);

		expect(source).not.toContain("ctx.vm");
		expect(mock.calls[0].args[1]).toEqual({
			total: 40,
			label: "fixed",
			nested: { owner: "ada" },
			tags: ["a", "ada"],
		});
	});

	it("treats runtime js-prefixed payload strings as data when useParam is set", async () => {
		const mock = createDbAdapter({ insert: { id: 1 } });
		const target = block("db", BlockTypes.db_insert, {
			connection: "conn-1",
			tableName: "orders",
			useParam: true,
			data: { source: "raw", value: {} },
		});

		// Request/previous-block data never becomes executable code at runtime.
		await runAround(target, { total: "js:return 6 * 7", label: "x" }, mock);

		expect(mock.calls[0].args[1]).toEqual({ total: "js:return 6 * 7", label: "x" });
	});

	it("rejects a non-object insert payload", async () => {
		const mock = createDbAdapter();
		const target = block("db", BlockTypes.db_insert, {
			connection: "conn-1",
			tableName: "orders",
			useParam: true,
			data: { source: "raw", value: {} },
		});

		const { result } = await runAround(target, "not an object", mock);

		expect(result.successful).toBe(false);
		expect(result.error.message).toBe(
			"error in insert: data to insert is not an object",
		);
		expect(mock.calls).toHaveLength(0);
	});

	it("passes data and conditions to update, and conditions to delete", async () => {
		const updateMock = createDbAdapter({ update: 1 });
		await runAround(
			block("db", BlockTypes.db_update, {
				connection: "conn-1",
				tableName: "users",
				useParam: false,
				conditions: [
					{ attribute: "id", operator: "eq", value: "js:return input.id", chain: "and" },
				],
				data: { source: "raw", value: { name: "js:return input.name" } },
			}),
			{ id: 3, name: "grace" },
			updateMock,
		);
		expect(updateMock.calls[0].args).toEqual([
			"users",
			{ name: "grace" },
			[{ attribute: "id", operator: "eq", value: 3, chain: "and" }],
		]);

		const deleteMock = createDbAdapter({ delete: 1 });
		await runAround(
			block("db", BlockTypes.db_delete, {
				connection: "conn-1",
				tableName: "users",
				conditions: [
					{ attribute: "id", operator: "eq", value: "js:return input.id", chain: "and" },
				],
			}),
			{ id: 3 },
			deleteMock,
		);
		expect(deleteMock.calls[0].args).toEqual([
			"users",
			[{ attribute: "id", operator: "eq", value: 3, chain: "and" }],
		]);
	});

	it("inserts in bulk and rejects a non-array payload", async () => {
		const mock = createDbAdapter({ insertBulk: 2 });
		const target = block("db", BlockTypes.db_insertbulk, {
			connection: "conn-1",
			tableName: "events",
			useParam: false,
			data: {
				source: "raw",
				value: [{ name: "js:return input.a" }, { name: "b" }],
			},
		});

		await runAround(target, { a: "first" }, mock);
		expect(mock.calls[0].args[1]).toEqual([{ name: "first" }, { name: "b" }]);

		const badMock = createDbAdapter();
		const { result } = await runAround(
			block("db", BlockTypes.db_insertbulk, {
				connection: "conn-1",
				tableName: "events",
				useParam: true,
				data: { source: "raw", value: [] },
			}),
			{ not: "an array" },
			badMock,
		);
		expect(result.error.message).toBe(
			"error in insert bulk: data to insert is not an array",
		);
	});

	it("exposes dbQuery to native block code and removes it afterwards", async () => {
		const mock = createDbAdapter({ raw: [{ count: 3 }] });
		const target = block("db", BlockTypes.db_native, {
			connection: "conn-1",
			js: "const rows = await dbQuery('select count(*) from users'); return rows[0].count;",
		});

		const { result, ctx } = await runAround(target, null, mock);

		expect(mock.calls[0].method).toBe("raw");
		expect(mock.calls[0].args[0]).toBe("select count(*) from users");
		expect(result.output.body).toBe(3);
		expect(ctx.vars.dbQuery).toBeUndefined();
	});

	it("commits a transaction and runs its executor chain", async () => {
		const mock = createDbAdapter({ insert: { id: 1 } });
		const blocks = [
			block("in", BlockTypes.entrypoint),
			block("tx", BlockTypes.db_transaction, {
				connection: "conn-1",
				executor: "child",
			}),
			block("child", BlockTypes.db_insert, {
				connection: "conn-1",
				tableName: "orders",
				useParam: false,
				data: { source: "raw", value: { total: 10 } },
			}),
			block("out", BlockTypes.response, { httpCode: "200" }),
		];
		const edges: EdgeDTOSchemaType = [
			edge("in", "tx"),
			edge("tx", "child", "executor"),
			edge("tx", "out"),
		];

		const { run } = compileGraph(blocks, edges);
		const result = await run(createContext(mock.adapter), null);

		expect(mock.calls.map((c) => c.method)).toEqual([
			"startTransaction",
			"insert",
			"commitTransaction",
		]);
		expect(result.output.httpCode).toBe("200");
	});

	it("rolls back when a block inside the transaction throws", async () => {
		const mock = createDbAdapter();
		mock.adapter.insert = async () => {
			throw new Error("constraint violation");
		};
		const blocks = [
			block("in", BlockTypes.entrypoint),
			block("tx", BlockTypes.db_transaction, {
				connection: "conn-1",
				executor: "child",
			}),
			block("child", BlockTypes.db_insert, {
				connection: "conn-1",
				tableName: "orders",
				useParam: false,
				data: { source: "raw", value: { total: 10 } },
			}),
			block("out", BlockTypes.response, { httpCode: "200" }),
		];
		const edges: EdgeDTOSchemaType = [
			edge("in", "tx"),
			edge("tx", "child", "executor"),
			edge("tx", "out"),
		];

		const { run } = compileGraph(blocks, edges);
		const result = await run(createContext(mock.adapter), null);

		expect(mock.calls.map((c) => c.method)).toEqual([
			"startTransaction",
			"rollbackTransaction",
		]);
		expect(result.successful).toBe(false);
		expect(result.error.message).toBe("failed to execute transaction db block");
		expect(result.error.cause.message).toBe("failed to execute insert db block");
	});

	it("routes a db failure to the error handler chain", async () => {
		const mock = createDbAdapter();
		mock.adapter.getSingle = async () => {
			throw new Error("connection refused");
		};
		const blocks = [
			block("in", BlockTypes.entrypoint),
			block("db", BlockTypes.db_getsingle, {
				connection: "conn-1",
				tableName: "users",
				conditions: [],
			}),
			block("out", BlockTypes.response, { httpCode: "200" }),
			block("err", BlockTypes.errorHandler, { next: "recover" }),
			block("recover", BlockTypes.response, { httpCode: "500" }),
		];
		const edges: EdgeDTOSchemaType = [
			edge("in", "db"),
			edge("db", "out"),
			edge("err", "recover"),
		];

		const { run } = compileGraph(blocks, edges);
		const result = await run(createContext(mock.adapter), null);

		expect(result.output.httpCode).toBe("500");
		expect(result.output.body).toContain("failed to execute get single db block");
	});
});
