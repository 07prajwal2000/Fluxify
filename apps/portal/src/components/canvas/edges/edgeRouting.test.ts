import { expect, test } from "bun:test";
import { Position } from "@xyflow/react";
import { routeEdge } from "./edgeRouting";

const out = (x: number, y: number) => ({ x, y, position: Position.Right });
const into = (x: number, y: number) => ({ x, y, position: Position.Left });

test("target ahead with a clear corridor stays a bezier", () => {
	expect(routeEdge(out(100, 0), into(400, 80), []).path).toContain("C");
});

test("a block in the way sends the edge around it, never through it", () => {
	const wall = { x: 200, y: -40, w: 100, h: 80 };
	const { path } = routeEdge(out(100, 0), into(400, 0), [wall]);
	expect(path).toContain("Q");
	// every point of the polyline's horizontal runs at wall height must be outside the wall
	const nums = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
	for (let i = 0; i + 3 < nums.length; i += 2) {
		const [x1, y1, x2, y2] = [nums[i], nums[i + 1], nums[i + 2], nums[i + 3]];
		const crosses = Math.min(x1, x2) < wall.x + wall.w && Math.max(x1, x2) > wall.x;
		if (y1 === y2 && crosses) expect(y1 <= wall.y || y1 >= wall.y + wall.h).toBe(true);
	}
});

test("target behind the source makes a hairpin, not a bezier", () => {
	const { path } = routeEdge(out(400, 0), into(100, 0), []);
	expect(path).toContain("Q");
	expect(path).not.toContain("C");
});

test("handles on top and bottom still route", () => {
	const { path } = routeEdge({ x: 200, y: 0, position: Position.Top }, into(500, 200), []);
	expect(path.startsWith("M 200 0")).toBe(true);
	expect(path.endsWith("500 200")).toBe(true);
});
