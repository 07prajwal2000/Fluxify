import { describe, expect, it } from "bun:test";
import { buildParamsTypeLib } from "./paramsTypes";

describe("buildParamsTypeLib", () => {
	it("types each param kind and drops integrations", () => {
		const lib = buildParamsTypeLib([
			{ name: "api_key", type: "app_config_selector", label: "API key" },
			{ name: "greeting", type: "text_input" },
			{ name: "dry_run", type: "checkbox" },
			{ name: "recipients", type: "array_editor" },
			{
				name: "mode",
				type: "dropdown",
				options: ["fast", { label: "Careful", value: "slow" }],
			},
			{ name: "connection", type: "integration_selector" },
		]);

		expect(lib).toContain("api_key: string;");
		expect(lib).toContain("/** API key */");
		expect(lib).toContain("greeting: string;");
		expect(lib).toContain("dry_run: boolean;");
		expect(lib).toContain("recipients: unknown[];");
		expect(lib).toContain('mode: "fast" | "slow";');
		expect(lib).not.toContain("connection");
	});

	it("falls back to string for a dropdown with no options", () => {
		expect(buildParamsTypeLib([{ name: "mode", type: "dropdown" }])).toContain(
			"mode: string;",
		);
	});
});
