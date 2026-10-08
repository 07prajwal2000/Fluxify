import { describe, expect, it } from "bun:test";
import { createJobContext } from "../service";

describe("getQueryParam", () => {
	it("is undefined when the param was not sent, so db conditions on it are skipped", () => {
		const ctx = createJobContext({ id: "j1", projectId: "p1", target: "t" });
		expect(ctx.vars.getQueryParam("status")).toBeUndefined();
	});
});
