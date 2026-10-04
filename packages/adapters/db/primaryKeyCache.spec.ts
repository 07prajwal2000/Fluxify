import { describe, expect, it, spyOn } from "bun:test";
import { MySqlAdapter } from "./mySqlAdapter";
import { PostgresAdapter } from "./postgresAdapter";

// #408: an adapter lives for one request, the pool much longer; the key lookup follows the pool
describe.each([
	["PostgresAdapter", PostgresAdapter],
	["MySqlAdapter", MySqlAdapter],
] as const)("%s primary key cache", (_, Adapter) => {
	const lookup = (pool: object, table = "t"): Promise<string[]> =>
		(new Adapter(pool as never, {} as never) as any).primaryKey(table);

	it("looks a table's key up once per pool, not once per adapter", async () => {
		const raw = spyOn(Adapter.prototype, "raw").mockResolvedValue([{ column_name: "id" }]);
		try {
			const pool = {};
			expect(await lookup(pool)).toEqual(["id"]);
			expect(await lookup(pool)).toEqual(["id"]);
			expect(raw).toHaveBeenCalledTimes(1);
			await lookup({}); // another pool, e.g. after the integration changed
			await lookup(pool, "other");
			expect(raw).toHaveBeenCalledTimes(3);
		} finally {
			raw.mockRestore();
		}
	});

	it("keeps 'no key' for the request only, so a key added later is found", async () => {
		const raw = spyOn(Adapter.prototype, "raw").mockResolvedValue([]);
		try {
			const pool = {};
			const request = new Adapter(pool as never, {} as never) as any;
			expect(await request.primaryKey("t")).toEqual([]);
			expect(await request.primaryKey("t")).toEqual([]);
			expect(raw).toHaveBeenCalledTimes(1);
			raw.mockResolvedValue([{ column_name: "id" }]);
			expect(await lookup(pool)).toEqual(["id"]); // the next request asks again
			expect(await lookup(pool)).toEqual(["id"]);
			expect(raw).toHaveBeenCalledTimes(2);
		} finally {
			raw.mockRestore();
		}
	});
});
