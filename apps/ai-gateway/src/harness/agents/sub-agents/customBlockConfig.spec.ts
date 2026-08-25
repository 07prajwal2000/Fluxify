import { describe, expect, it } from "bun:test";
import { settleName, validateCustomBlockConfigOutput } from "./customBlockConfig";
import type { GlobalGraphState, SubAgentResult } from "../../types";

const check = (result: SubAgentResult) =>
	validateCustomBlockConfigOutput(result, "t-1", {} as GlobalGraphState);

describe("settleName", () => {
	it("strips the storage prefix the model copies out of the inventory", () => {
		// The exact name a failed run proposed: correct intent, wrong vocabulary.
		expect(settleName("user_defined.project.generate_random_ids", new Set())).toBe(
			"generate_random_ids",
		);
	});

	it("still resolves a collision after stripping", () => {
		expect(
			settleName(
				"user_defined.project.generate_jwt",
				new Set(["user_defined.project.generate_jwt"]),
			),
		).toBe("generate_jwt_2");
	});

	it("leaves a bare, free name alone", () => {
		expect(settleName("send_notification", new Set())).toBe("send_notification");
	});
});

describe("validateCustomBlockConfigOutput", () => {
	it("says what is wrong with the name, so a retry can fix it", () => {
		const error = check({
			action: "create",
			data: { name: "Generate Random IDs", label: "x", inputParams: [] },
		});
		// A retry only helps if the review names the offending value.
		expect(error).toContain("Generate Random IDs");
	});

	it("accepts a bare snake_case create", () => {
		expect(
			check({
				action: "create",
				data: { name: "generate_random_ids", label: "Generate Random IDs", inputParams: [] },
			}),
		).toBeNull();
	});

	it("rejects incomplete type-specific parameters", () => {
		expect(
		check({
			action: "create",
			data: { name: "choose_mode", label: "Choose Mode", inputParams: [{ type: "dropdown", name: "mode", label: "Mode", options: [] }] },
		}),
	).toBeTruthy();
		expect(
		check({
			action: "create",
			data: { name: "use_db", label: "Use DB", inputParams: [{ type: "integration_selector", name: "database", label: "Database", group: "" }] },
		}),
	).toBeTruthy();
	});
});
