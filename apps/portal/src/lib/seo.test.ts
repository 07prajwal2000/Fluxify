import { describe, expect, it } from "bun:test";
import { formatProjectTitle, formatTitle } from "./seo";

describe("SEO Utilities", () => {
	it("formatTitle appends brand if not present", () => {
		expect(formatTitle("POST /api/v1/users | Routes")).toBe(
			"POST /api/v1/users | Routes | Fluxify",
		);
		expect(formatTitle("Projects")).toBe("Projects | Fluxify");
		expect(formatTitle("Fluxify AI")).toBe("Fluxify AI");
		expect(formatTitle("Overview | Fluxify")).toBe("Overview | Fluxify");
	});

	it("formatProjectTitle formats with project name and section", () => {
		expect(formatProjectTitle("My Project", "Project Settings")).toBe(
			"My Project | Project Settings",
		);
		expect(formatProjectTitle("My Project", "Routes")).toBe("My Project | Routes");
		expect(formatProjectTitle("My Project", "")).toBe("My Project | Project");
		expect(formatProjectTitle("My Project")).toBe("My Project | Project");
	});

	it("formatProjectTitle falls back gracefully when project name is empty or null", () => {
		expect(formatProjectTitle(null, "Project Settings")).toBe("Project Settings");
		expect(formatProjectTitle(undefined, "Routes")).toBe("Routes");
		expect(formatProjectTitle("", "Workflows")).toBe("Workflows");
		expect(formatProjectTitle(null)).toBe("Project");
	});
});
