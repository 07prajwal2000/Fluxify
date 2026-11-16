import { describe, expect, it } from "bun:test";
import { type BackupHistory, freshCanvasIds } from "../backup";

const A = "0190a1b2-0000-7000-8000-00000000000a";
const B = "0190a1b2-0000-7000-8000-00000000000b";
const E = "0190a1b2-0000-7000-8000-00000000000e";

const snapshot = (script: string) => ({
	blocks: [
		{ id: A, key: "entrypoint_1", type: "entrypoint", data: {}, position: { x: 0, y: 0 } },
		{ id: B, key: "js_1", type: "jsrunner", data: { value: script, next: A }, position: { x: 1, y: 0 } },
	],
	edges: [{ id: E, from: A, to: B, fromHandle: `${A}-source`, toHandle: `${B}-target` }],
	settings: {},
});

const history: BackupHistory = {
	working: snapshot("return 'two';"),
	versions: [
		{
			number: 1,
			parent: null,
			title: "one",
			description: null,
			authorEmail: null,
			createdAt: "2026-01-01T00:00:00.000Z",
			snapshot: snapshot(`return '${A}x';`),
		},
	],
	prod: 1,
	head: null,
	canvasRevision: 3,
	committedRevision: null,
};

describe("freshCanvasIds", () => {
	it("gives every block and edge one new id, the same in the working copy and every version", () => {
		const out = freshCanvasIds(history);
		const [a, b] = out.working.blocks.map((x) => x.id);
		const edge = out.working.edges[0]!;
		expect([a, b, edge.id]).not.toContain(A);
		expect(new Set([a, b, edge.id]).size).toBe(3);
		expect(edge).toMatchObject({ from: a, to: b, fromHandle: `${a}-source`, toHandle: `${b}-target` });
		// a reference inside block data moves with the block
		expect((out.working.blocks[1]!.data as { next: string }).next).toBe(a!);
		expect(out.versions[0]!.snapshot.blocks.map((x) => x.id)).toEqual([a!, b!]);
	});

	it("leaves an id that is only part of a longer string alone", () => {
		expect((freshCanvasIds(history).versions[0]!.snapshot.blocks[1]!.data as { value: string }).value).toBe(
			`return '${A}x';`,
		);
	});

	it("rewrites references beside the history the same way, given a record that holds it", () => {
		const out = freshCanvasIds({ history, hooks: [{ blockId: B }, { blockId: "other" }] }, history);
		expect(out.hooks).toEqual([{ blockId: out.history.working.blocks[1]!.id }, { blockId: "other" }]);
		expect(out.hooks[0]!.blockId).not.toBe(B);
	});
});
