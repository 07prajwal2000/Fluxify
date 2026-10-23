import { describe, expect, it } from "bun:test";
import {
	blockIdProblem,
	customBlockId,
	longestCustomBlockId,
	MAX_BLOCK_ID_LENGTH,
	MAX_PROJECT_ID_LENGTH,
} from "../index.js";

const pluginName = (length: number) => `${"a".repeat(length - 2)}/b`;
const typeOf = (plugin: string) => `${plugin}/hello`;

describe("recorded block ids (#952)", () => {
	it("builds the id a worker's block library knows the block by", () => {
		expect(customBlockId("acme/slack", "1.2.3", "p1", "acme/slack/messages/post")).toBe(
			"acme/slack@1.2.3:p1:acme/slack/messages/post",
		);
	});

	it("budgets the project id at its maximum", () => {
		const id = customBlockId("acme/slack", "1.2.3", "x".repeat(MAX_PROJECT_ID_LENGTH), "acme/slack/post");
		expect(longestCustomBlockId("acme/slack", "1.2.3", "acme/slack/post")).toBe(id.length);
	});

	// the plugin name and type both grow by one per character, so the id is 2n + 64
	it("accepts a plugin whose longest id is exactly the limit", () => {
		expect(blockIdProblem(pluginName(218), "1.2.3", [typeOf(pluginName(218))])).toBeUndefined();
	});

	it("names the block and how far over it is when the id cannot fit", () => {
		const plugin = pluginName(219);
		const problem = blockIdProblem(plugin, "1.2.3", [typeOf(plugin)])!;
		expect(problem).toContain(`block '${typeOf(plugin)}'`);
		expect(problem).toContain(`2 over the ${MAX_BLOCK_ID_LENGTH}-character limit`);
	});
});
