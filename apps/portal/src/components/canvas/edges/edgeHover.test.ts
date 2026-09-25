import { expect, test } from "bun:test";
import { pickEdge, pointsBox } from "./edgeHover";

test("box is handle to handle, padded, whichever way the handles sit", () => {
	expect(pointsBox({ x: 100, y: 0 }, { x: 300, y: -200 })).toEqual({ x1: 60, y1: -240, x2: 340, y2: 40 });
	expect(pointsBox({ x: 300, y: -200 }, { x: 100, y: 0 })).toEqual({ x1: 60, y1: -240, x2: 340, y2: 40 });
});

test("innermost box wins, outside every box is none", () => {
	const outer = pointsBox({ x: 0, y: 0 }, { x: 600, y: 200 });
	const inner = pointsBox({ x: 200, y: 100 }, { x: 300, y: 100 });
	expect(pickEdge({ x: 250, y: 100 }, [["outer", outer], ["inner", inner]])).toBe("inner");
	expect(pickEdge({ x: 500, y: 50 }, [["outer", outer], ["inner", inner]])).toBe("outer");
	expect(pickEdge({ x: 900, y: 50 }, [["outer", outer]])).toBeNull();
});
