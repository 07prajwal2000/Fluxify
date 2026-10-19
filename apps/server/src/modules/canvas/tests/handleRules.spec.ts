import { describe, expect, it } from "bun:test";
import { assertOutputHandles } from "../handleRules";

const specs = {
	agent: {
		in: ["target"],
		out: ["success", "failure"] as ["success", "failure"],
		body: [
			{ name: "tools", corner: "bottom-left" as const, allowMultiple: true },
			{ name: "model", corner: "top-right" as const },
		],
	},
};
const typeOf = (id: string) => (id.startsWith("a") ? "agent" : "jsrunner");
const edge = (id: string, from: string, h: string) => ({ id, from, fromHandle: `${from}-${h}` });

describe("assertOutputHandles", () => {
	it("rejects a handle the spec does not have", () => {
		expect(() => assertOutputHandles(typeOf, [edge("e1", "a1", "source")], specs)).toThrow(
			/agent block a1 has no "source" handle/,
		);
	});

	it("lets an allowMultiple handle fan out, and nothing else", () => {
		expect(() =>
			assertOutputHandles(typeOf, [edge("e1", "a1", "tools"), edge("e2", "a1", "tools")], specs),
		).not.toThrow();
		expect(() =>
			assertOutputHandles(typeOf, [edge("e1", "a1", "model"), edge("e2", "a1", "model")], specs),
		).toThrow(/multiple outgoing edges/);
	});

	it("keeps builtin rules with no spec", () => {
		expect(() => assertOutputHandles(typeOf, [edge("e1", "j1", "source"), edge("e2", "j1", "source")])).toThrow(
			/multiple outgoing edges/,
		);
	});
});
