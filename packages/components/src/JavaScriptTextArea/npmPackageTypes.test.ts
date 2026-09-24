import { describe, expect, it } from "bun:test";
import { minVersion } from "./npmPackageTypes";

describe("minVersion", () => {
	it("takes the lowest version a range allows", () => {
		expect(minVersion("^1.2.3")).toBe("1.2.3");
		expect(minVersion("~5.26.4")).toBe("5.26.4");
		expect(minVersion(">=2.0.0-beta.1 <3")).toBe("2.0.0-beta.1");
		expect(minVersion("*")).toBe("latest");
	});
});
