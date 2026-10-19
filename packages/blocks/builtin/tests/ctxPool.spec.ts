import { afterEach, describe, expect, it } from "bun:test";
import { BlockTypes } from "../../blockTypes";
import { compileGraph } from "../../compiler";
import { closeCtxPools, ctxPoolStats } from "../ctxPool";
import { customBlockNames, registerModuleBlock, unregisterBlock } from "../customBlock";
import { block, createContext, edge } from "./compilerTestHelpers";

const TYPE = "acme/demo/pooled";
const KEY = { token: "t-1", opts: { b: 2, a: 1 } };

afterEach(async () => {
	for (const project of ["proj-1", "proj-2"])
		for (const name of customBlockNames(project)) unregisterBlock(project, name);
	await closeCtxPools();
});

type Run = Parameters<typeof registerModuleBlock>[2];

/** entry -> pooled block -> response, compiled for `projectId`; the block's output is the body */
function graphFor(projectId: string, run: Run) {
	const meta = { handles: { in: ["target"], out: ["source"], body: [] } } as any;
	registerModuleBlock(projectId, TYPE, run, meta);
	const { run: execute } = compileGraph(
		[
			block("1", BlockTypes.entrypoint),
			block("2", TYPE as any),
			block("3", BlockTypes.response, { httpCode: "200" }),
		],
		[edge("1", "2"), edge("2", "3")],
		{ projectId, blockMeta: { [TYPE]: meta } },
	);
	return async () => {
		const result = await execute({ ...createContext(), projectId }, {});
		return result.output ? result.output.body : result;
	};
}

const clients = () => {
	const made: { id: number; closed: boolean }[] = [];
	return {
		made,
		create: () => {
			const client = { id: made.length + 1, closed: false };
			made.push(client);
			return client;
		},
		destroy: (c: { closed: boolean }) => {
			c.closed = true;
		},
	};
};

describe("ctx.pool", () => {
	it("hands the same client to two runs and keys by the key's value, not its identity", async () => {
		const c = clients();
		const call = graphFor("proj-1", async ({ ctx }) => {
			const key = { opts: { a: 1, b: 2 }, token: "t-1" }; // new object, other key order
			return { output: (await ctx.pool!("slack", key, c)).id };
		});
		expect(await call()).toBe(1);
		expect(await call()).toBe(1);
		expect(c.made).toHaveLength(1);
	});

	it("builds a new client for a changed key value and leaves the old one alone", async () => {
		const c = clients();
		let key: unknown = KEY;
		const call = graphFor("proj-1", async ({ ctx }) => ({
			output: (await ctx.pool!("slack", key, c)).id,
		}));
		expect(await call()).toBe(1);
		key = { ...KEY, token: "t-2" };
		expect(await call()).toBe(2);
		expect(c.made[0].closed).toBe(false);
	});

	it("never shares a client between projects, even for identical config", async () => {
		const c = clients();
		const run: Run = async ({ ctx }) => ({ output: (await ctx.pool!("slack", KEY, c)).id });
		const one = graphFor("proj-1", run);
		const two = graphFor("proj-2", run);
		expect(await one()).toBe(1);
		expect(await two()).toBe(2);
		expect(await one()).toBe(1);
	});

	it("holds its leases until run settles, then releases them", async () => {
		const c = clients();
		let during: ReturnType<typeof ctxPoolStats> | undefined;
		const call = graphFor("proj-1", async ({ ctx }) => {
			await ctx.pool!("slack", KEY, c);
			await ctx.pool!("slack", KEY, c);
			during = ctxPoolStats();
			return {};
		});
		await call();
		expect(during).toEqual({ active: 1, retiring: 0, leases: 2 });
		expect(ctxPoolStats()).toEqual({ active: 1, retiring: 0, leases: 0 });
	});

	it("concurrent first calls create one client", async () => {
		let creates = 0;
		const create = async () => {
			creates++;
			await new Promise((r) => setTimeout(r, 10));
			return {};
		};
		const call = graphFor("proj-1", async ({ ctx }) => {
			const [a, b, d] = await Promise.all(
				[0, 1, 2].map(() => ctx.pool!("slack", KEY, { create })),
			);
			return { output: a === b && b === d };
		});
		expect(await call()).toBe(true);
		expect(creates).toBe(1);
	});

	it("a create that throws reaches the run, caches nothing, and the next run retries", async () => {
		let attempts = 0;
		const call = graphFor("proj-1", async ({ ctx }) => ({
			output: await ctx.pool!("slack", KEY, {
				create: async () => {
					if (++attempts === 1) throw new Error("connect refused");
					return { ok: true };
				},
			}),
		}));
		expect(await call()).toMatchObject({ successful: false, error: { message: "connect refused" } });
		expect(ctxPoolStats().active).toBe(0);
		expect(await call()).toEqual({ ok: true });
		expect(attempts).toBe(2);
	});

	it("a destroy that throws is logged, not thrown, on shutdown", async () => {
		const call = graphFor("proj-1", async ({ ctx }) => ({
			output: await ctx.pool!("slack", KEY, {
				create: () => ({}),
				destroy: () => {
					throw new Error("close failed");
				},
			}),
		}));
		await call();
		await closeCtxPools();
		expect(ctxPoolStats()).toEqual({ active: 0, retiring: 0, leases: 0 });
	});

	it("shutdown closes every pooled client", async () => {
		const c = clients();
		const call = graphFor("proj-1", async ({ ctx }) => ({
			output: (await ctx.pool!("slack", KEY, c)).id + (await ctx.pool!("db", KEY, c)).id,
		}));
		await call();
		await closeCtxPools();
		expect(c.made.map((m) => m.closed)).toEqual([true, true]);
	});

	it("a late call after run settled gets a client and holds no lease", async () => {
		const c = clients();
		let late: (() => Promise<unknown>) | undefined;
		const call = graphFor("proj-1", async ({ ctx }) => {
			late = () => ctx.pool!("slack", KEY, c);
			return {};
		});
		await call();
		await late!();
		expect(c.made).toHaveLength(1);
		expect(ctxPoolStats().leases).toBe(0);
	});
});
