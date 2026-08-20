import { describe, expect, it } from "bun:test";
import {
	resolveCustomBlockName,
	uniqueCustomBlockName,
	withCustomBlockPrefix,
	withoutCustomBlockPrefix,
} from "../customBlockName";

describe("withCustomBlockPrefix", () => {
	it("prefixes a bare name", () => {
		expect(withCustomBlockPrefix("jwt_validate")).toBe(
			"user_defined.project.jwt_validate",
		);
	});

	it("is idempotent", () => {
		const once = withCustomBlockPrefix("jwt_validate");
		expect(withCustomBlockPrefix(once)).toBe(once);
	});

	it("round-trips", () => {
		expect(withoutCustomBlockPrefix(withCustomBlockPrefix("notify"))).toBe(
			"notify",
		);
	});
});

describe("resolveCustomBlockName", () => {
	const known = new Set([
		"user_defined.project.jwt_validate", // created through the project endpoint
		"send_email", // inhouse: stored bare, never prefixed
	]);

	it("prefixes a bare project block", () => {
		expect(resolveCustomBlockName("jwt_validate", known)).toBe(
			"user_defined.project.jwt_validate",
		);
	});

	it("leaves an inhouse block bare", () => {
		expect(resolveCustomBlockName("send_email", known)).toBe("send_email");
	});

	it("does not double-prefix an already-resolved name", () => {
		expect(
			resolveCustomBlockName("user_defined.project.jwt_validate", known),
		).toBe("user_defined.project.jwt_validate");
	});

	it("strips a prefix wrongly applied to an inhouse block", () => {
		expect(resolveCustomBlockName("user_defined.project.send_email", known)).toBe(
			"send_email",
		);
	});

	it("assumes a name it has never seen is a block being created now", () => {
		expect(resolveCustomBlockName("brand_new", known)).toBe(
			"user_defined.project.brand_new",
		);
	});
});

describe("uniqueCustomBlockName", () => {
	it("keeps a name nothing has taken", () => {
		expect(uniqueCustomBlockName("jwt_validate", new Set())).toBe(
			"jwt_validate",
		);
	});

	it("renames around a stored project block", () => {
		expect(
			uniqueCustomBlockName(
				"jwt_validate",
				new Set(["user_defined.project.jwt_validate"]),
			),
		).toBe("jwt_validate_2");
	});

	it("renames around an inhouse block that would shadow it", () => {
		// stored bare, so no database conflict — but `custom:jwt_validate`
		// would resolve to the inhouse block, not the one being created
		expect(uniqueCustomBlockName("jwt_validate", new Set(["jwt_validate"]))).toBe(
			"jwt_validate_2",
		);
	});

	it("skips suffixes that are themselves taken", () => {
		expect(
			uniqueCustomBlockName(
				"jwt_validate",
				new Set([
					"user_defined.project.jwt_validate",
					"user_defined.project.jwt_validate_2",
					"user_defined.project.jwt_validate_3",
				]),
			),
		).toBe("jwt_validate_4");
	});

	it("stays lowercase snake_case, which the config validator requires", () => {
		const renamed = uniqueCustomBlockName(
			"jwt_validate",
			new Set(["jwt_validate"]),
		);
		expect(renamed).toMatch(/^[a-z0-9_]+$/);
	});
});
