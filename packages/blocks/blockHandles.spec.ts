import { describe, expect, it } from "bun:test";
import {
	BLOCK_OUTPUT_HANDLES,
	BODY_HANDLES,
	FAN_OUT_HANDLES,
	getOutputHandles,
	HANDLE_SIDE,
	type HandleKind,
	type HandleSpec,
	handleCorner,
	handleSpecSchema,
	isBodyHandle,
	isFanOutHandle,
	sideOf,
} from "./blockHandles";
import { BlockTypes } from "./blockTypes";
import { registerModuleBlock, unregisterBlock } from "./builtin/customBlock";
import { layoutGraph } from "./layout";
import { handleSide } from "./layoutLanes";

/** `[success, failure]` plus two body handles, one fanning out */
const agent: HandleSpec = {
	in: ["target"],
	out: ["success", "failure"],
	body: [
		{ name: "tools", corner: "bottom-left", allowMultiple: true },
		{ name: "model", corner: "top-right" },
	],
};

describe("handleSpecSchema", () => {
	it.each([[[]], [["source"]], [["success", "failure"]]])("accepts out %j", (out) => {
		expect(handleSpecSchema.parse({ out })).toEqual({ in: ["target"], out, body: [] });
	});

	it.each([
		["another out shape", { out: ["failure", "success"] }],
		["a custom out", { out: ["next"] }],
		["source plus success", { out: ["source", "success"] }],
		["duplicate body names", { out: [], body: [{ name: "a", corner: "top-left" }, { name: "a", corner: "top-right" }] }],
		["a body name clashing with an output", { out: ["source"], body: [{ name: "source", corner: "top-left" }] }],
		["duplicate inputs", { in: ["target", "target"], out: [] }],
		["a hyphen in a name", { out: [], body: [{ name: "my-tools", corner: "top-left" }] }],
		["an empty name", { in: [""], out: [] }],
		["a bad corner", { out: [], body: [{ name: "a", corner: "left" }] }],
	])("rejects %s", (_, spec) => {
		expect(handleSpecSchema.safeParse(spec).success).toBe(false);
	});
});

describe("handle resolution", () => {
	it("is unchanged for every builtin type with no spec", () => {
		for (const type of Object.values(BlockTypes)) {
			const expected = BLOCK_OUTPUT_HANDLES[type] ?? ["source"];
			expect(getOutputHandles(type)).toEqual(expected);
			for (const h of expected) {
				expect(isBodyHandle(h)).toBe(BODY_HANDLES.includes(h));
				expect(isFanOutHandle(h)).toBe(FAN_OUT_HANDLES.includes(h));
				expect(sideOf(h)).toBe(HANDLE_SIDE[h as HandleKind]);
				expect(handleCorner(h)).toBeUndefined();
			}
		}
	});

	it("reads a spec'd type's own handles, corners and fan-out", () => {
		expect(getOutputHandles("acme/agent", agent)).toEqual(["success", "failure", "tools", "model"]);
		expect(isBodyHandle("tools", agent)).toBe(true);
		expect(isBodyHandle("success", agent)).toBe(false);
		expect(isFanOutHandle("tools", agent)).toBe(true);
		expect(isFanOutHandle("model", agent)).toBe(false);
		// a builtin fan-out name means nothing to a spec that does not declare it
		expect(isFanOutHandle("case", agent)).toBe(false);
		expect(handleCorner("tools", agent)).toBe("bottom-left");
		expect(sideOf("tools", agent)).toBe("bottom");
		expect(sideOf("model", agent)).toBe("top");
		expect(sideOf("target", agent)).toBe("left");
		expect(sideOf("failure", agent)).toBe("right");
		expect(handleSide("b1-tools", agent)).toBe("bottom");
		expect(handleSide("b1-tools")).toBe("right");
	});
});

describe("layout with a spec'd type", () => {
	it("puts body branches above the success/failure lanes, in spec order", () => {
		const nodes = ["entry", "agent", "ok", "ko", "tool", "llm"].map((id) => ({
			id,
			type: id === "agent" ? "acme/agent" : BlockTypes.jsrunner,
		}));
		const edge = (to: string, h: string) => ({ from: "agent", to, fromHandle: `agent-${h}` });
		const edges = [
			{ from: "entry", to: "agent" },
			edge("ko", "failure"),
			edge("ok", "success"),
			edge("llm", "model"),
			edge("tool", "tools"),
		];
		const y = (p: Record<string, { y: number }>) =>
			["tool", "llm", "ok", "ko"].sort((a, b) => p[a]!.y - p[b]!.y);
		const at = layoutGraph(nodes, edges, { handleSpecs: { "acme/agent": agent } });
		expect(y(at)).toEqual(["tool", "llm", "ok", "ko"]);
		// without the spec the unknown handles are plain lanes, not bodies
		expect(y(layoutGraph(nodes, edges))).not.toEqual(["tool", "llm", "ok", "ko"]);
	});
});

describe("registerModuleBlock", () => {
	it("validates the handle spec on register", () => {
		const run = () => ({});
		expect(() =>
			registerModuleBlock("p", "bad", run, { handles: { in: [], out: ["next"] } as never }),
		).toThrow();
		registerModuleBlock("p", "good", run, { handles: { out: ["source"] } as never });
		unregisterBlock("p", "good");
	});
});
