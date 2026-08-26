import { describe, expect, it } from "bun:test";
import { renderCanvas } from "./renderCanvas";

const block = (over: Record<string, any> = {}) => ({
	id: "0199-a",
	blockType: "jsrunner",
	blockName: "Build greeting",
	blockDescription: "Creates the payload",
	// As `dbService.getCanvas` returns it: the lifted fields are still in `data`.
	data: {
		blockName: "Build greeting",
		blockDescription: "Creates the payload",
		value: "return { message: 'hello' }",
	},
	position: { x: 240, y: 48 },
	connections: [{ blockId: "0199-b", handle: "source" }],
	...over,
});

describe("renderCanvas", () => {
	it("renders a block as a stanza, not JSON", () => {
		const out = renderCanvas([block()]);

		expect(out).toContain('jsrunner 0199-a "Build greeting" @240,48');
		expect(out).toContain("  # Creates the payload");
		expect(out).toContain("  value: return { message: 'hello' }");
		expect(out).toContain("  -> 0199-b");
	});

	it("states the name and description once", () => {
		// They arrive twice — lifted onto the row and left inside `data`. The
		// block builder's output contract forbids writing them into `data`, so
		// showing them there teaches it the opposite of what it must emit.
		const out = renderCanvas([block()]);

		expect(out.match(/Build greeting/g)).toHaveLength(1);
		expect(out.match(/Creates the payload/g)).toHaveLength(1);
	});

	it("names a handle only when it is not the default", () => {
		const out = renderCanvas([
			block({
				blockType: "if",
				connections: [
					{ blockId: "0199-t", handle: "true" },
					{ blockId: "0199-f", handle: "false" },
					{ blockId: "0199-n", handle: "source" },
				],
			}),
		]);

		expect(out).toContain("  -> [true] 0199-t");
		expect(out).toContain("  -> [false] 0199-f");
		expect(out).toContain("  -> 0199-n");
	});

	it("keeps multi-line code readable", () => {
		const out = renderCanvas([
			block({ data: { value: "const x = 1;\nreturn x;" } }),
		]);

		expect(out).toContain("  value: |\n    const x = 1;\n    return x;");
	});

	it("does not let a string that looks like JSON read back as structure", () => {
		const out = renderCanvas([block({ data: { value: '{"a":1}' } })]);

		expect(out).toContain('  value: "{\\"a\\":1}"');
	});

	it("leaves template expressions alone", () => {
		// `{{ ... }}` opens with a brace but is not JSON, and it is the most
		// common value in a canvas — quoting every one of them is pure noise.
		const out = renderCanvas([block({ data: { body: "{{ $jsrunner_4 }}" } })]);

		expect(out).toContain("  body: {{ $jsrunner_4 }}");
	});

	it("teaches the notation it renders in", () => {
		// An agent meeting `->` cold has to guess, and a guessed edge is a wrong
		// graph. No call site can hand over the shape without the key to it.
		expect(renderCanvas([block()])).toContain("Canvas notation:");
	});

	it("says a canvas is empty rather than rendering nothing", () => {
		expect(renderCanvas([])).toContain("no blocks yet");
		expect(renderCanvas(null)).toContain("no blocks yet");
	});

	it("costs a fraction of the JSON it replaces", () => {
		const canvas = [block(), block({ id: "0199-b", connections: [] })];

		expect(renderCanvas(canvas).length).toBeLessThan(
			JSON.stringify(canvas).length,
		);
	});
});
