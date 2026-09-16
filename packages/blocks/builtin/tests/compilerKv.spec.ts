import { describe, it, expect } from "bun:test";
import { compileGraph } from "../../compiler";
import { BlockTypes } from "../../blockTypes";
import type { BlockDTOType, EdgeDTOSchemaType } from "../../builderTypes";

/** records every adapter call so the tests can assert what reached the client */
function createKvAdapter(results: Record<string, any> = {}) {
	const calls: { method: string; args: any[] }[] = [];
	const record =
		(method: string) =>
		async (...args: any[]) => {
			calls.push({ method, args });
			return results[method];
		};
	const client = { incr: record("incr") };
	return {
		calls,
		client,
		adapter: {
			get: record("get"),
			set: record("set"),
			setex: record("setex"),
			delete: record("delete"),
			getConnection: () => client,
		},
	};
}

function createContext(adapter: any) {
	const vars: Record<string, any> = {};
	return {
		route: "/kv",
		apiId: "api-1",
		projectId: "proj-1",
		vars,
		kvFactory: { getKvAdapter: () => adapter },
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
	const edges: EdgeDTOSchemaType = [
		edge("in", target.id),
		edge(target.id, "out"),
	];
	return { blocks, edges };
}

async function runAround(target: BlockDTOType, input: any, mock: any) {
	const { blocks, edges } = graphAround(target);
	const { run, source } = compileGraph(blocks, edges);
	const ctx = createContext(mock.adapter);
	const result = await run(ctx, input);
	return { result, ctx, source };
}

describe("compiled kv blocks", () => {
	it("gets a key and returns the stored value", async () => {
		const mock = createKvAdapter({ get: "ada" });
		const target = block("kv", BlockTypes.kv_operations, {
			connection: "conn-1",
			operation: "get",
			key: "user:7",
		});

		const { result } = await runAround(target, null, mock);

		expect(mock.calls[0].method).toBe("get");
		expect(mock.calls[0].args[0]).toBe("user:7");
		expect(result.output.body).toBe("ada");
	});

	it("evaluates a js expression in the key", async () => {
		const mock = createKvAdapter({ get: null });
		const target = block("kv", BlockTypes.kv_operations, {
			connection: "conn-1",
			operation: "get",
			key: "js:return 'user:' + input.id",
		});

		await runAround(target, { id: 7 }, mock);

		expect(mock.calls[0].args[0]).toBe("user:7");
	});

	it("parses the stored value as JSON when asked", async () => {
		const mock = createKvAdapter({ get: '{"id":7,"name":"ada"}' });
		const target = block("kv", BlockTypes.kv_operations, {
			connection: "conn-1",
			operation: "get",
			key: "user:7",
			parseJson: true,
		});

		const { result } = await runAround(target, null, mock);

		expect(result.output.body).toEqual({ id: 7, name: "ada" });
	});

	it("leaves a missing key as null rather than parsing it", async () => {
		const mock = createKvAdapter({ get: null });
		const target = block("kv", BlockTypes.kv_operations, {
			connection: "conn-1",
			operation: "get",
			key: "gone",
			parseJson: true,
		});

		const { result } = await runAround(target, null, mock);

		expect(result.output.body).toBeNull();
	});

	it("fails the block when a value is not valid JSON", async () => {
		const mock = createKvAdapter({ get: "not json" });
		const target = block("kv", BlockTypes.kv_operations, {
			connection: "conn-1",
			operation: "get",
			key: "k",
			parseJson: true,
		});

		const { result } = await runAround(target, null, mock);

		expect(result.error.message).toBe("failed to execute get kv block");
	});

	it("sets without a ttl when none is given", async () => {
		const mock = createKvAdapter();
		const target = block("kv", BlockTypes.kv_operations, {
			connection: "conn-1",
			operation: "set",
			key: "k",
			value: "v",
		});

		const { result } = await runAround(target, null, mock);

		expect(mock.calls[0].method).toBe("set");
		expect(mock.calls[0].args).toEqual(["k", "v"]);
		expect(result.output.body).toBe(true);
	});

	it("routes a positive ttl to setex, and stores objects as JSON", async () => {
		const mock = createKvAdapter();
		const target = block("kv", BlockTypes.kv_operations, {
			connection: "conn-1",
			operation: "set",
			key: "k",
			value: { a: 1 },
			ttl: 60,
		});

		await runAround(target, null, mock);

		expect(mock.calls[0].method).toBe("setex");
		expect(mock.calls[0].args).toEqual(["k", 60, '{"a":1}']);
	});

	it("stores the previous block's output when useParam is set", async () => {
		const mock = createKvAdapter();
		const target = block("kv", BlockTypes.kv_operations, {
			connection: "conn-1",
			operation: "set",
			key: "k",
			useParam: true,
			// ignored in favour of the input
			value: "unused",
		});

		await runAround(target, { id: 7 }, mock);

		expect(mock.calls[0].method).toBe("set");
		expect(mock.calls[0].args).toEqual(["k", '{"id":7}']);
	});

	it("treats a blank or zero ttl as no expiry", async () => {
		for (const ttl of ["", 0, null]) {
			const mock = createKvAdapter();
			const target = block("kv", BlockTypes.kv_operations, {
				connection: "conn-1",
				operation: "set",
				key: "k",
				value: "v",
				ttl,
			});

			await runAround(target, null, mock);

			expect(mock.calls[0].method).toBe("set");
		}
	});

	it("deletes a key and reports success", async () => {
		const mock = createKvAdapter();
		const target = block("kv", BlockTypes.kv_operations, {
			connection: "conn-1",
			operation: "delete",
			key: "k",
		});

		const { result } = await runAround(target, null, mock);

		expect(mock.calls[0].method).toBe("delete");
		expect(result.output.body).toBe(true);
	});

	it("wraps an adapter failure in the block's own error", async () => {
		const mock = createKvAdapter();
		mock.adapter.get = async () => {
			throw new Error("connection refused");
		};
		const target = block("kv", BlockTypes.kv_operations, {
			connection: "conn-1",
			operation: "get",
			key: "k",
		});

		const { result } = await runAround(target, null, mock);

		expect(result.error.message).toBe("failed to execute get kv block");
	});

	it("exposes the raw client as kv and removes it afterwards", async () => {
		const mock = createKvAdapter({ incr: 4 });
		const target = block("kv", BlockTypes.kv_raw, {
			connection: "conn-1",
			js: "return await kv.incr('hits');",
		});

		const { result, ctx } = await runAround(target, null, mock);

		expect(mock.calls[0].method).toBe("incr");
		expect(mock.calls[0].args[0]).toBe("hits");
		expect(result.output.body).toBe(4);
		// the global must not outlive the snippet
		expect(ctx.vars.kv).toBeUndefined();
	});
});
