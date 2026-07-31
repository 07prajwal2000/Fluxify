import { describe, expect, it } from "bun:test";
import { Checkbox, CheckboxContent, CheckboxControl, CheckboxIndicator, CheckboxRoot } from "./Checkbox";

describe("Checkbox component", () => {
	it("has displayName Checkbox", () => {
		expect(Checkbox.displayName).toBe("Checkbox");
	});

	it("exports compound subcomponents", () => {
		expect(Checkbox.Root).toBe(CheckboxRoot);
		expect(Checkbox.Content).toBe(CheckboxContent);
		expect(Checkbox.Control).toBe(CheckboxControl);
		expect(Checkbox.Indicator).toBe(CheckboxIndicator);
	});
});
