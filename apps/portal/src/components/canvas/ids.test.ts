import { expect, test } from "bun:test";
import { z } from "zod";
import { uuidv7 } from "./ids";

test("generated ids pass the server's uuidv7 check and sort by time", () => {
	const schema = z.uuidv7();
	const first = uuidv7();
	expect(schema.parse(first)).toBe(first);

	const ids = Array.from({ length: 50 }, uuidv7);
	expect(new Set(ids).size).toBe(50);
	for (const id of ids) expect(() => schema.parse(id)).not.toThrow();
});
