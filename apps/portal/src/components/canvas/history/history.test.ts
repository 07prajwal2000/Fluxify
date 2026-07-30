import { expect, test } from "bun:test";
import { createHistoryStack } from "./historyStack";
import type { CanvasSnapshot } from "./useCanvasHistory";

function snapshot(positions: Record<string, [number, number]>): CanvasSnapshot {
	return {
		positions: Object.fromEntries(
			Object.entries(positions).map(([id, [x, y]]) => [id, { x, y }]),
		),
		edges: [],
	};
}

test("one entry undoes a bulk move, and redo puts it back", () => {
	const stack = createHistoryStack<CanvasSnapshot>();
	const before = snapshot({ a: [0, 0], b: [0, 0] });
	// Both blocks moved in a single drag gesture → a single commit.
	const after = snapshot({ a: [100, 100], b: [200, 200] });

	stack.commit(before);
	expect(stack.sizes()).toEqual({ past: 1, future: 0 });

	expect(stack.undo(after)).toBe(before);
	expect(stack.sizes()).toEqual({ past: 0, future: 1 });

	expect(stack.redo(before)).toBe(after);
	expect(stack.sizes()).toEqual({ past: 1, future: 0 });
});

test("undo/redo at the ends is a no-op, and a commit drops the redo branch", () => {
	const stack = createHistoryStack<CanvasSnapshot>();
	const a = snapshot({ a: [0, 0] });
	const b = snapshot({ a: [1, 1] });

	expect(stack.undo(a)).toBeNull();
	expect(stack.redo(a)).toBeNull();

	stack.commit(a);
	stack.undo(b);
	expect(stack.sizes()).toEqual({ past: 0, future: 1 });

	stack.commit(a);
	expect(stack.sizes()).toEqual({ past: 1, future: 0 });
	expect(stack.redo(a)).toBeNull();
});

test("the stack is capped at its limit", () => {
	const stack = createHistoryStack<CanvasSnapshot>(3);
	for (let i = 0; i < 10; i++) stack.commit(snapshot({ a: [i, i] }));
	expect(stack.sizes().past).toBe(3);
	// Oldest entries dropped: the next undo returns the most recent commit.
	expect(stack.undo(snapshot({ a: [99, 99] }))?.positions.a).toEqual({ x: 9, y: 9 });
});
