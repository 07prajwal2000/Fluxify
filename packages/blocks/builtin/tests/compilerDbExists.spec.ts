import { describe, expect, it } from "bun:test";
import { BlockTypes } from "../../blockTypes";
import { compileGraph } from "../../compiler";
import { block, collectSpans, edge } from "./compilerTestHelpers";

const data = (extra: any = {}) => ({
	connection: "conn-1",
	tableName: "users",
	conditions: [
		{
			attribute: { kind: "column", value: "id" },
			operator: "eq",
			value: { kind: "literal", value: "js:return input.id" },
			chain: "and",
		},
	],
	columns: ["id", "name"],
	joins: [{ table: "orgs", attribute: "users.org_id = orgs.id", type: "left" }],
	...extra,
});

function context(getSingle: (...args: any[]) => Promise<any>) {
	const calls: any[][] = [];
	const adapter = {
		getSingle: async (...args: any[]) => {
			calls.push(args);
			return getSingle(...args);
		},
	};
	const ctx = {
		route: "/db",
		apiId: "api-1",
		projectId: "proj-1",
		vars: {} as Record<string, any>,
		dbFactory: { getDbAdapter: () => adapter },
		stopper: { timeoutEnd: 0, duration: 10000 },
	} as any;
	return { ctx, calls };
}

/** entrypoint -> db_exists -> (success: 200 | failure: 404) */
function compile(extra?: any) {
	return compileGraph(
		[
			block("in", BlockTypes.entrypoint),
			block("db", BlockTypes.db_exists, data(extra)),
			block("hit", BlockTypes.response, { httpCode: "200" }),
			block("miss", BlockTypes.response, { httpCode: "404" }),
			block("err", BlockTypes.errorHandler, { next: "recover" }),
			block("recover", BlockTypes.response, { httpCode: "500" }),
		],
		[
			edge("in", "db"),
			edge("db", "hit", "success"),
			edge("db", "miss", "failure"),
			edge("err", "recover"),
		],
	);
}

const save = { saveAsVariable: { enabled: true, name: "user" } };

describe("compiled db_exists block", () => {
	it("takes success with the row as output, passing columns and joins through", async () => {
		const { ctx, calls } = context(async () => ({ id: 7, name: "ada" }));
		const result = await compile().run(ctx, { id: 7 });

		expect(result.output).toEqual({ httpCode: "200", body: { id: 7, name: "ada" } });
		expect(calls[0][0]).toBe("users");
		expect(calls[0][1][0].value).toEqual({ kind: "literal", value: 7 });
		expect(calls[0][2]).toEqual({ columns: ["id", "name"], joins: data().joins, sort: [] });
	});

	it("takes failure with the input unchanged when no row matches", async () => {
		const { ctx } = context(async () => null);
		const result = await compile().run(ctx, { id: 9 });

		expect(result.output).toEqual({ httpCode: "404", body: { id: 9 } });
	});

	it("saves the row on success and clears the variable on failure", async () => {
		const hit = context(async () => ({ id: 7 }));
		await compile(save).run(hit.ctx, { id: 7 });
		expect(hit.ctx.vars.outputs.user).toEqual({ id: 7 });

		const miss = context(async () => null);
		miss.ctx.vars.outputs = { user: { id: 7 } }; // left over from an earlier iteration
		await compile(save).run(miss.ctx, { id: 9 });
		expect(miss.ctx.vars.outputs.user).toBeNull();
	});

	it("tags the span with the branch taken", async () => {
		const { ctx } = context(async () => null);
		const { spans, trace } = collectSpans();
		ctx.trace = trace;
		await compile().run(ctx, { id: 9 });

		expect(spans.find((s) => s.blockId === "db")?.branch).toBe("failure");
	});

	it("routes a real db error to the error handler, not the failure branch", async () => {
		const { ctx } = context(async () => {
			throw new Error("connection refused");
		});
		const result = await compile().run(ctx, { id: 7 });

		expect(result.output.httpCode).toBe("500");
		expect(result.output.body).toContain("failed to execute get single db block");
	});
});
