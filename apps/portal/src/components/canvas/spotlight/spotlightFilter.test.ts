import { describe, expect, it } from "bun:test";
import { filterSpotlightCommands } from "./spotlightFilter";
import type { SpotlightCommand } from "./types";

const mockCommands: SpotlightCommand[] = [
	{
		id: "canvas-save",
		title: "Save",
		category: "Actions",
		keywords: ["save", "disk"],
		onSelect: () => {},
	},
	{
		id: "canvas-format",
		title: "Format blocks",
		category: "Actions",
		keywords: ["format", "layout"],
		onSelect: () => {},
	},
	{
		id: "addNote",
		title: "Add note",
		category: "Actions",
		keywords: ["note", "sticky"],
		onSelect: () => {},
	},
	{
		id: "block-if",
		title: "Add Block: If",
		subtitle: "Block • Flow",
		category: "Blocks",
		keywords: ["add", "block", "if", "branch"],
		onSelect: () => {},
	},
	{
		id: "block-httprequest",
		title: "Add Block: Http Request",
		subtitle: "Block • HTTP",
		description: "Call an external HTTP endpoint",
		category: "Blocks",
		keywords: ["add", "block", "httprequest", "http"],
		onSelect: () => {},
	},
	{
		id: "nav-routes",
		title: "Go to: API Routes",
		category: "Navigation",
		keywords: ["goto", "routes"],
		onSelect: () => {},
	},
	{
		id: "nav-settings",
		title: "Go to: Project Settings",
		category: "Navigation",
		keywords: ["goto", "settings"],
		onSelect: () => {},
	},
	{
		id: "resource-route-1",
		title: "Route: GET /api/users",
		subtitle: "API Route • Users list",
		category: "Resources",
		keywords: ["goto", "route", "get", "/api/users"],
		onSelect: () => {},
	},
	{
		id: "resource-wf-1",
		title: "Workflow: Daily Backup",
		category: "Resources",
		keywords: ["goto", "workflow", "backup"],
		onSelect: () => {},
	},
	{
		id: "help-docs",
		title: "Open Documentation",
		category: "Help",
		keywords: ["docs", "help"],
		onSelect: () => {},
	},
];

describe("filterSpotlightCommands", () => {
	it("returns actions, navigation, and help when query is empty", () => {
		const { commands, mode } = filterSpotlightCommands(mockCommands, "");
		expect(mode).toBe("all");
		const categories = commands.map((c) => c.category);
		expect(categories).toContain("Actions");
		expect(categories).toContain("Navigation");
		expect(categories).toContain("Help");
		expect(categories).not.toContain("Resources");
		expect(categories).not.toContain("Blocks");
	});

	it("switches to goto mode when query starts with 'goto'", () => {
		const { commands, mode } = filterSpotlightCommands(mockCommands, "goto");
		expect(mode).toBe("goto");
		// Navigation first, then Resources
		const firstResourceIndex = commands.findIndex((c) => c.category === "Resources");
		const lastNavIndex = commands
			.map((c) => c.category)
			.lastIndexOf("Navigation");
		expect(firstResourceIndex).toBeGreaterThan(lastNavIndex);
		expect(commands.some((c) => c.id === "nav-routes")).toBe(true);
		expect(commands.some((c) => c.id === "resource-route-1")).toBe(true);
	});

	it("filters items within goto mode", () => {
		const { commands, mode } = filterSpotlightCommands(mockCommands, "goto users");
		expect(mode).toBe("goto");
		expect(commands.length).toBe(1);
		expect(commands[0].id).toBe("resource-route-1");
	});

	it("switches to add mode and shows blocks when query starts with 'add'", () => {
		const { commands, mode } = filterSpotlightCommands(mockCommands, "add");
		expect(mode).toBe("add");
		expect(commands.some((c) => c.id === "block-if")).toBe(true);
		expect(commands.some((c) => c.id === "block-httprequest")).toBe(true);
		expect(commands.some((c) => c.id === "addNote")).toBe(true);
		expect(commands.every((c) => c.category === "Blocks" || c.id === "addNote")).toBe(true);
	});

	it("filters blocks with 'add >' prefix", () => {
		const { commands, mode } = filterSpotlightCommands(mockCommands, "add > http");
		expect(mode).toBe("add");
		expect(commands.length).toBe(1);
		expect(commands[0].id).toBe("block-httprequest");
	});

	it("performs scored general search for keywords", () => {
		const { commands, mode } = filterSpotlightCommands(mockCommands, "backup");
		expect(mode).toBe("all");
		expect(commands.length).toBe(1);
		expect(commands[0].id).toBe("resource-wf-1");
	});

	it("matches canvas action shortcut or title", () => {
		const { commands } = filterSpotlightCommands(mockCommands, "format");
		expect(commands.length).toBe(1);
		expect(commands[0].id).toBe("canvas-format");
	});
});
