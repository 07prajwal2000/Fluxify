import { describe, expect, it, mock } from "bun:test";

let lastRun: object | undefined;
mock.module("../repository", () => ({ lastRunSample: async () => lastRun }));

const { default: handleRequest } = await import("../service");

const suite = (assertions: object[]) => ({ id: "s1", assertions }) as any;
const successCheck = { target: "body", propertyPath: "success", operator: "true" };

describe("validate test suite (#716)", () => {
	it("says so when there is no run to check against", async () => {
		lastRun = undefined;
		const result = await handleRequest(suite([successCheck]), {});
		expect(result).toMatchObject({ source: null, checked: 0, problems: [] });
		expect(result.message).toContain("No recorded run");
	});

	it("checks against the last run", async () => {
		lastRun = { status: 400, body: { message: "bad", errors: [] } };
		const result = await handleRequest(suite([successCheck]), {});
		expect(result.source).toBe("last run");
		expect(result.problems).toEqual([
			"Check 1, body(success): (property not found: success). body has: message, errors",
		]);
		expect(result.message).toBe("1 of 1 checks do not fit the last run");
	});

	it("prefers a sample, and passes when the paths fit", async () => {
		lastRun = { body: {} };
		const result = await handleRequest(suite([successCheck]), { sample: { body: { success: true } } });
		expect(result).toMatchObject({ source: "sample", checked: 1, problems: [] });
		expect(result.message).toBe("1 checks fit the sample");
	});
});
