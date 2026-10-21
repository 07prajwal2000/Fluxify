import { describe, expect, it } from "bun:test";
import {
	activeSorts,
	bulkChunkSize,
	changedRows,
	columnRefSchema,
	conflictKeys,
	conflictUpdateColumns,
	counterDelta,
	type DatabaseAdapter,
	dbOperatorSchema,
	decode,
	deepEqual,
	encodePayload,
	errorText,
	groupIntrospectionRows,
	isCounterOp,
	isNumericLike,
	isolationClause,
	isRetryableTransactionError,
	isTransactionUnsupported,
	type KvAdapter,
	literalRefSchema,
	type McpAdapter,
	McpNotConnectedError,
	NOT_CONNECTED,
	type ObservabilityAdapter,
	QueueConnection,
	QueueProducer,
	QueueSourceGoneError,
	resolveCustomHeaders,
	resolveMcpHeaders,
	settleEach,
	structuredWhereConditionSchema,
	toMongoField,
	whereConditionSchema,
	withTiebreaker,
} from "../integrations.js";

describe("SDK integrations contracts & pure helpers", () => {
	describe("queue helpers", () => {
		it("decode: parses JSON, text, and empty bytes", () => {
			expect(decode(new Uint8Array())).toBeNull();
			const jsonBytes = new TextEncoder().encode(JSON.stringify({ a: 1 }));
			expect(decode(jsonBytes)).toEqual({ a: 1 });
			const textBytes = new TextEncoder().encode("plain text");
			expect(decode(textBytes)).toBe("plain text");
		});

		it("encodePayload: string, JSON, BigInt, and invalid types", () => {
			expect(encodePayload("hello")).toBe("hello");
			expect(encodePayload({ foo: "bar" })).toBe('{"foo":"bar"}');
			expect(encodePayload(123)).toBe("123");
			expect(encodePayload(BigInt(9007199254740991))).toBe('"9007199254740991"');
			expect(() => encodePayload(undefined)).toThrow("The payload is undefined");
			expect(() => encodePayload(() => {})).toThrow("cannot be sent as JSON");
		});

		it("settleEach: settles messages into outcomes", async () => {
			const messages = [
				{ destination: "q1", payload: "msg1" },
				{ destination: "q2", payload: "msg2" },
			];
			const outcomes = await settleEach(messages, async (msg) => {
				if (msg.destination === "q2") throw new Error("broker full");
				return { messageId: "123" };
			});
			expect(outcomes).toEqual([
				{ index: 0, ok: true, result: { messageId: "123" } },
				{ index: 1, ok: false, error: "broker full" },
			]);
		});

		it("errorText and QueueSourceGoneError", () => {
			expect(errorText(new Error("custom err"))).toBe("custom err");
			expect(errorText("raw string")).toBe("raw string");
			const gone = new QueueSourceGoneError("topic gone");
			expect(gone.name).toBe("QueueSourceGoneError");
			expect(gone.message).toBe("topic gone");
		});
	});

	describe("observability helpers", () => {
		it("resolveCustomHeaders: resolves literals, cfg: values and drops empty", () => {
			const configMap = new Map<string, string | number | boolean>([
				["SECRET_TOKEN", "bearer-xyz"],
			]);
			const resolved = resolveCustomHeaders(
				{
					Authorization: "cfg:SECRET_TOKEN",
					"X-Static": "static-val",
					"X-Missing": "cfg:UNKNOWN",
				},
				configMap,
			);
			expect(resolved).toEqual({
				Authorization: "bearer-xyz",
				"X-Static": "static-val",
			});
			expect(resolveCustomHeaders(undefined, configMap)).toEqual({});
		});
	});

	describe("mcp helpers", () => {
		it("resolveMcpHeaders and McpNotConnectedError", () => {
			const appConfigs = new Map<string, string>([["TOKEN", "mcp-token"]]);
			const headers = resolveMcpHeaders(
				[
					{ key: "Authorization", value: "cfg:TOKEN" },
					{ key: "Content-Type", value: "application/json" },
				],
				appConfigs,
			);
			expect(headers).toEqual({
				Authorization: "mcp-token",
				"Content-Type": "application/json",
			});
			const err = new McpNotConnectedError();
			expect(err.name).toBe("McpNotConnectedError");
			expect(err.message).toBe(NOT_CONNECTED);
		});
	});

	describe("database helpers & schemas", () => {
		it("activeSorts and withTiebreaker", () => {
			expect(activeSorts([{ attribute: "name", direction: "asc" }])).toEqual([
				{ attribute: "name", direction: "asc" },
			]);
			expect(activeSorts([{ attribute: undefined as any, direction: "asc" }])).toEqual([]);
			expect(() => activeSorts([{ attribute: "   ", direction: "asc" }])).toThrow("no column");

			const tied = withTiebreaker(
				[{ attribute: "created_at", direction: "desc" }],
				["id"],
				"users",
			);
			expect(tied).toEqual([
				{ attribute: "created_at", direction: "desc" },
				{ attribute: "id", direction: "asc" },
			]);
		});

		it("conflictUpdateColumns and conflictKeys", () => {
			const rows = [{ id: 1, name: "Alice", email: "a@x.com" }];
			expect(conflictUpdateColumns(rows, { target: ["id"], action: "update" })).toEqual([
				"name",
				"email",
			]);
			expect(
				conflictUpdateColumns(rows, { target: ["id"], action: "update", update: ["name"] }),
			).toEqual(["name"]);

			expect(conflictKeys(rows, ["id", "email"])).toEqual([{ id: 1, email: "a@x.com" }]);
			expect(() => conflictKeys(rows, ["missing"])).toThrow('no value for "missing"');
		});

		it("counter helpers", () => {
			expect(isCounterOp({ op: "inc", value: 10 })).toBeTrue();
			expect(isCounterOp({ op: "dec", value: 5 })).toBeTrue();
			expect(isCounterOp({ op: "other", value: 5 })).toBeFalse();
			expect(isCounterOp(123)).toBeFalse();

			expect(counterDelta("views", { op: "inc", value: 2 })).toBe(2);
			expect(counterDelta("views", { op: "dec", value: 2 })).toBe(-2);
			expect(() => counterDelta("views", { op: "inc", value: "abc" })).toThrow();
		});

		it("path, numeric and isolation helpers", () => {
			expect(toMongoField("user.address.zip")).toBe("user.address.zip");
			expect(toMongoField("items[0].name")).toBe("items.0.name");
			expect(isNumericLike(42)).toBeTrue();
			expect(isNumericLike("42")).toBeTrue();
			expect(isNumericLike("abc")).toBeFalse();

			expect(isolationClause("serializable")).toBe(" ISOLATION LEVEL SERIALIZABLE");
			expect(isolationClause(undefined)).toBe("");
		});

		it("groupIntrospectionRows and bulkChunkSize", () => {
			const rows = [
				{ table_name: "users", column_name: "id", data_type: "int", ref_table: null },
				{ table_name: "users", column_name: "role_id", data_type: "int", ref_table: "roles" },
			];
			const tables = groupIntrospectionRows(rows);
			expect(tables).toEqual([
				{
					table: "users",
					columns: [
						{ name: "id", type: "int", owner: "users" },
						{ name: "role_id", type: "int", owner: "roles" },
					],
				},
			]);
			expect(bulkChunkSize([{ a: 1, b: 2 }])).toBe(1000);
		});

		it("deepEqual and changedRows", () => {
			expect(deepEqual({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] })).toBeTrue();
			expect(deepEqual({ a: 1 }, { a: 2 })).toBeFalse();

			const before = new Map([
				["1", { id: 1, v: "old" }],
				["2", { id: 2, v: "same" }],
			]);
			const after = [
				{ id: 1, v: "new" },
				{ id: 2, v: "same" },
				{ id: 3, v: "added" },
			];
			const changed = changedRows(before, after, (r) => String(r.id));
			expect(changed).toEqual([
				{ id: 1, v: "new" },
				{ id: 3, v: "added" },
			]);
		});

		it("transaction errors detection", () => {
			expect(isRetryableTransactionError({ errno: "40P01" })).toBeTrue();
			expect(isRetryableTransactionError({ errno: 1213 })).toBeTrue();
			expect(isRetryableTransactionError({ errno: "OTHER" })).toBeFalse();
			expect(isTransactionUnsupported({ code: 20, message: "Transaction numbers are only allowed" })).toBeTrue();
		});

		it("where conditions and operator schemas", () => {
			expect(dbOperatorSchema.safeParse("eq").success).toBeTrue();
			expect(dbOperatorSchema.safeParse("is_null").success).toBeTrue();
			expect(columnRefSchema.safeParse({ kind: "column", value: "colA" }).success).toBeTrue();
			expect(literalRefSchema.safeParse({ kind: "literal", value: "litA" }).success).toBeTrue();

			const condition = {
				attribute: "status",
				operator: "eq",
				value: "active",
				chain: "and",
			};
			expect(structuredWhereConditionSchema.safeParse(condition).success).toBeTrue();
			expect(whereConditionSchema.safeParse(condition).success).toBeTrue();

			const grouped = {
				group: [condition],
				chain: "or",
			};
			expect(whereConditionSchema.safeParse(grouped).success).toBeTrue();
		});
	});
});
