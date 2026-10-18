import { describe, expect, it } from "bun:test";
import { planExtraction } from "./plan";

const b = (key: string, type = "response") => ({
	id: `id_${key}`,
	key,
	type,
	data: {},
	position: { x: 0, y: 0 },
});
const e = (from: string, to: string) => ({
	id: `${from}>${to}`,
	from: `id_${from}`,
	to: `id_${to}`,
	fromHandle: `id_${from}-source`,
	toHandle: `id_${to}-target`,
});
const blocks = ["entrypoint_1", "a_1", "b_1", "c_1", "d_1"].map((k) =>
	b(k, k.startsWith("entry") ? "entrypoint" : "js_runner"),
);
const chain = [e("entrypoint_1", "a_1"), e("a_1", "b_1"), e("b_1", "c_1"), e("c_1", "d_1")];

describe("planExtraction", () => {
	it("takes a chain with one edge in and one edge out", () => {
		const p = planExtraction(blocks, chain, ["b_1", "c_1"]);
		expect(p.head.key).toBe("b_1");
		expect(p.incoming.id).toBe("a_1>b_1");
		expect(p.outgoing.id).toBe("c_1>d_1");
		expect(p.inner).toHaveLength(1);
	});
	it("refuses an empty selection, unknown keys and the entrypoint", () => {
		expect(() => planExtraction(blocks, chain, [])).toThrow("at least one");
		expect(() => planExtraction(blocks, chain, ["nope_1"])).toThrow("No block nope_1");
		expect(() => planExtraction(blocks, chain, ["entrypoint_1"])).toThrow("can't be extracted");
	});
	it("refuses two entry blocks", () => {
		expect(() => planExtraction(blocks, chain, ["a_1", "c_1"])).toThrow("2 entry blocks");
	});
	it("refuses several edges leaving the selection", () => {
		const fan = [...chain, e("b_1", "d_1")];
		expect(() => planExtraction(blocks, fan, ["a_1", "b_1"])).toThrow("single last block");
	});
});
