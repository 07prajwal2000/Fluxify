import { describe, expect, it } from "bun:test";
import { isOn, triggerOn } from "./switches";

describe("trigger switches (#1072)", () => {
	it("reads production's switch for production and development's for development", () => {
		const devOnly = { active: false, devActive: true };
		expect(triggerOn(devOnly, "development")).toBe(true);
		expect(triggerOn(devOnly, "production")).toBe(false);
		const prodOnly = { active: true, devActive: false };
		expect(triggerOn(prodOnly, "production")).toBe(true);
		expect(triggerOn(prodOnly, "development")).toBe(false);
	});

	it("is on while either switch is", () => {
		expect(isOn({ active: false, devActive: false })).toBe(false);
		expect(isOn({ active: true, devActive: false })).toBe(true);
		expect(isOn({ active: false, devActive: true })).toBe(true);
	});
});
