import { describe, expect, it, mock } from "bun:test";

mock.module("../../../db", () => ({ db: {} }));

import { integrationValueProblem } from "../paramCheck";

const owner = { label: "block acme/x/step", granted: ["kv"] };
const param = { type: "integration", kind: "kv" } as const;

describe("integrationValueProblem", () => {
	// not a uuid: the lookup answers without a query
	it("refuses an id naming nothing in the project", async () => {
		expect(await integrationValueProblem(owner, param, "nope", "p1")).toBe(
			"no integration nope in this project",
		);
	});

	it("lets it pass when the id may come from another project", async () => {
		expect(await integrationValueProblem(owner, param, "nope", "p1", undefined, true)).toBeUndefined();
	});
});
