import { describe, expect, test } from "bun:test";
import type { Context } from "../../baseBlock";
import { adapterFor } from "./schema";
import { runTransactionDb } from "./transaction";

/** records what the transaction asked of it; `commitErrors` fail the next commits in turn */
function fakeContext(commitErrors: unknown[] = []) {
	const calls: string[] = [];
	const adapter = {
		startTransaction: async (isolation?: string) => {
			calls.push(`begin${isolation ? ` ${isolation}` : ""}`);
		},
		commitTransaction: async () => {
			calls.push("commit");
			const error = commitErrors.shift();
			if (error) throw error;
		},
		rollbackTransaction: async () => {
			calls.push("rollback");
		},
		raw: async () => calls.push("query"),
	};
	const context = { dbFactory: { getDbAdapter: () => adapter } } as unknown as Context;
	return { context, calls };
}

const deadlock = Object.assign(new Error("deadlock detected"), { errno: "40P01" });

describe("runTransactionDb", () => {
	test("commits with the isolation level asked for", async () => {
		const { context, calls } = fakeContext();
		const outcome = await runTransactionDb(context, "db", async () => "done", true, {
			isolation: "serializable",
		});
		expect(outcome).toEqual({ result: "done" });
		expect(calls).toEqual(["begin serializable", "commit"]);
	});

	test("a timeout rolls back, and the body's later calls are refused", async () => {
		const { context, calls } = fakeContext();
		let late: unknown;
		const finished = Promise.withResolvers<void>();
		const outcome = await runTransactionDb(
			context,
			"db",
			async () => {
				await Bun.sleep(40);
				try {
					await adapterFor(context, "db").raw("insert");
				} catch (error) {
					late = error;
				}
				finished.resolve();
			},
			true,
			{ timeoutMs: 10 },
		);
		expect(outcome).toEqual({
			failure: { reason: "timeout", message: "transaction timed out after 10ms" },
		});
		await finished.promise;
		expect(String(late)).toContain("timed out");
		expect(calls).toEqual(["begin", "rollback"]);
		// the failure branch itself still reaches the database
		await adapterFor(context, "db").raw("log");
		expect(calls).toEqual(["begin", "rollback", "query"]);
	});

	test("a timeout with no failure branch fails the route", async () => {
		const { context } = fakeContext();
		const run = runTransactionDb(context, "db", () => Bun.sleep(40), false, { timeoutMs: 10 });
		await expect(run).rejects.toThrow("failed to execute transaction db block");
	});

	test("a deadlock is retried and then commits", async () => {
		const { context, calls } = fakeContext();
		let tries = 0;
		const outcome = await runTransactionDb(
			context,
			"db",
			async () => {
				if (++tries === 1) throw new Error("wrapped", { cause: deadlock });
				return "ok";
			},
			true,
			{ retries: 2 },
		);
		expect(outcome).toEqual({ result: "ok" });
		expect(calls).toEqual(["begin", "rollback", "begin", "commit"]);
	});

	test("a serialization failure at commit is retried without a second rollback", async () => {
		const { context, calls } = fakeContext([
			Object.assign(new Error("could not serialize"), { errno: "40001" }),
		]);
		const outcome = await runTransactionDb(context, "db", async () => "ok", true, { retries: 1 });
		expect(outcome).toEqual({ result: "ok" });
		expect(calls).toEqual(["begin", "commit", "begin", "commit"]);
	});

	test("retries default to none, and other errors are never retried", async () => {
		const { context, calls } = fakeContext();
		const outcome = await runTransactionDb(
			context,
			"db",
			async () => {
				throw deadlock;
			},
			true,
		);
		expect(outcome).toEqual({ failure: { reason: "error", message: "deadlock detected" } });
		const other = fakeContext();
		await runTransactionDb(
			other.context,
			"db",
			async () => {
				throw new Error("bad column");
			},
			true,
			{ retries: 3 },
		);
		expect(calls).toEqual(["begin", "rollback"]);
		expect(other.calls).toEqual(["begin", "rollback"]);
	});

	test("a Mongo standalone server gets a clear error", async () => {
		const { context } = fakeContext();
		const outcome = await runTransactionDb(
			context,
			"db",
			async () => {
				throw new Error("failed to execute insert db block", {
					cause: Object.assign(
						new Error("Transaction numbers are only allowed on a replica set member or mongos"),
						{ code: 20 },
					),
				});
			},
			true,
		);
		expect(outcome).toMatchObject({
			failure: { reason: "error", message: expect.stringContaining("need a replica set") },
		});
	});
});
