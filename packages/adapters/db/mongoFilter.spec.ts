import { describe, expect, it } from "bun:test";
import { ObjectId } from "mongodb";
import { type MongoShape, mongoField, mongoFilter, storedDoc } from "./mongoFilter";

const HEX = "65f1a2b3c4d5e6f708192a3b";
const oid = ObjectId.createFromHexString(HEX);
const shape = (fields: Record<string, string[]>): MongoShape => {
	const types = new Map(Object.entries(fields).map(([k, v]) => [k, new Set(v)]));
	return { ownId: types.has("id"), types };
};
const eq = (attribute: string, value: unknown) => [
	{ attribute, operator: "eq", value, chain: "and" },
];

describe("mongoFilter ids (#511)", () => {
	it("matches an ObjectId field by its hex string", () => {
		const s = shape({ _id: ["objectId"], riderId: ["objectId", "null"] });
		expect(mongoFilter(eq("riderId", HEX) as never, s)).toEqual({ riderId: { $eq: oid } });
		expect(mongoFilter(eq("id", HEX) as never, s)).toEqual({ _id: { $eq: oid } });
	});

	it("matches either form where the field's type is unknown or mixed", () => {
		const s = shape({ code: ["string", "objectId"] });
		expect(mongoFilter(eq("code", HEX) as never, s)).toEqual({ code: { $in: [HEX, oid] } });
		expect(mongoFilter(eq("other", "plain") as never, s)).toEqual({ other: { $eq: "plain" } });
		const inList = [{ attribute: "x", operator: "not_in", value: [HEX, "b"], chain: "and" }];
		expect(mongoFilter(inList as never, s)).toEqual({ x: { $nin: [HEX, oid, "b"], $ne: null } });
	});

	it("fails on a string that can't be an ObjectId on an ObjectId field", () => {
		const s = shape({ _id: ["objectId"] });
		expect(() => mongoFilter(eq("id", "nope") as never, s)).toThrow(
			'id holds ObjectIds: "nope" is not one (24 hex characters)',
		);
	});

	it("lets `id` mean a real id field when documents have one", () => {
		const s = shape({ _id: ["objectId"], id: ["number"] });
		expect(mongoFilter(eq("id", 7) as never, s)).toEqual({ id: { $eq: 7 } });
		expect(mongoField("id", s)).toBe("id");
		expect(mongoField("id", shape({}))).toBe("_id");
	});
});

describe("storedDoc", () => {
	it("stores id strings as ObjectIds only on fields that hold them", () => {
		const s = shape({ riderId: ["objectId"], note: ["string"] });
		expect(storedDoc({ riderId: HEX, note: HEX, n: 1 }, s)).toEqual({
			riderId: oid,
			note: HEX,
			n: 1,
		});
		expect(() => storedDoc({ riderId: "r1" }, s)).toThrow('riderId holds ObjectIds: "r1"');
	});
});
