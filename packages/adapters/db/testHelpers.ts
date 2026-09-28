export {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "../containerTestHelpers";

import { expect } from "bun:test";
import type { IDbAdapter, WriteResult } from ".";

/** #503: update/delete `{ count, affected }` for 0, 1 and many rows; `table` has name and status */
export async function checkWriteResults(adapter: IDbAdapter, table: string) {
	const where = (value: string) => [
		{ attribute: "name", operator: "eq" as const, value, chain: "and" as const },
	];
	const pick = ({ count, affected }: WriteResult) => ({
		count,
		rows: affected
			.map((r) => `${r.name}:${r.status}`)
			.sort()
			.join(" "),
	});
	await adapter.insertBulk(table, [
		{ name: "a", status: "placed" },
		{ name: "b", status: "placed" },
		{ name: "c", status: "cancelled" },
	]);

	expect(pick(await adapter.update(table, { status: "x" }, where("none")))).toEqual({
		count: 0,
		rows: "",
	});
	expect(pick(await adapter.update(table, { status: "shipped" }, where("a")))).toEqual({
		count: 1,
		rows: "a:shipped",
	});
	// c already holds the value: matched, not changed
	expect(pick(await adapter.update(table, { status: "cancelled" }, []))).toEqual({
		count: 2,
		rows: "a:cancelled b:cancelled",
	});
	expect(pick(await adapter.update(table, { status: "cancelled" }, where("c")))).toEqual({
		count: 0,
		rows: "",
	});

	expect(pick(await adapter.delete(table, where("none")))).toEqual({ count: 0, rows: "" });
	expect(pick(await adapter.delete(table, where("a")))).toEqual({ count: 1, rows: "a:cancelled" });
	expect(pick(await adapter.delete(table, []))).toEqual({
		count: 2,
		rows: "b:cancelled c:cancelled",
	});
}
