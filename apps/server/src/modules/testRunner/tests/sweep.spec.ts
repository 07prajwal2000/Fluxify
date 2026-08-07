import { describe, expect, it, mock } from "bun:test";

const updates: Array<{ table: unknown; values: any }> = [];

mock.module("../../../db", () => ({
	db: {
		update(table: unknown) {
			const call = { table, values: undefined as any };
			updates.push(call);
			const chain = {
				set(values: any) {
					call.values = values;
					return chain;
				},
				where: () => chain,
				returning: async () => [{ id: "x" }],
			};
			return chain;
		},
	},
}));

const { sweepStrandedTestRuns } = await import("../sweep");
const { testRunsEntity, testSuiteRunsEntity } = await import(
	"../../../db/schema"
);

describe("sweepStrandedTestRuns", () => {
	it("marks stranded rows in both tables as error", async () => {
		await sweepStrandedTestRuns();

		expect(updates).toHaveLength(2);
		expect(updates.map((u) => u.table)).toEqual([
			testSuiteRunsEntity,
			testRunsEntity,
		]);
		for (const { values } of updates) {
			expect(values.status).toBe("error");
			expect(values.finishedAt).toBeInstanceOf(Date);
			expect(values.result.error).toBe("server restarted");
		}
	});
});
