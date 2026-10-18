import { getBezierPath, Position } from "@xyflow/react";

export type Rect = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };
/** A handle's canvas position and the side it sits on. */
export type EdgeEnd = Pt & { position: Position };
export type Route = { path: string; labelX: number; labelY: number };

/** Straight run out of a handle before the first turn. */
const STUB = 20;
/** Clearance kept between a routed edge and any block. */
const PAD = 14;
/** Cost of a turn, in pixels of path: higher = fewer, longer lines. */
const BEND = 40;
/** Corner radius of the rounded turns. */
const RADIUS = 12;
/** Offset of the extra lanes beside each stub, so there is always room to turn around (hairpin). */
const LANE = 40;
/** Slack at both ends of the "straight ahead" corridor, for handles that sit a few px inside the card. */
const CLEAR = 6;

// Index order matters: opposite of i is (i + 2) % 4.
const STEPS: Pt[] = [
	{ x: 1, y: 0 },
	{ x: 0, y: 1 },
	{ x: -1, y: 0 },
	{ x: 0, y: -1 },
];
const OUT: Record<Position, number> = {
	[Position.Right]: 0,
	[Position.Bottom]: 1,
	[Position.Left]: 2,
	[Position.Top]: 3,
};

export const encodeRects = (rects: Rect[]) =>
	rects.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join(";");
export const decodeRects = (key: string): Rect[] =>
	key
		? key.split(";").map((s) => {
				const [x, y, w, h] = s.split(",").map(Number);
				return { x, y, w, h };
			})
		: [];

/**
 * Picks the edge's shape from where the blocks are: a smooth bezier when the
 * target is ahead of the source with nothing in between, otherwise a rounded
 * orthogonal route that goes around blocks (a hairpin when the target is behind).
 */
export function routeEdge(src: EdgeEnd, dst: EdgeEnd, rects: Rect[]): Route {
	if (isClearAhead(src, dst, rects)) return bezier(src, dst);
	const pts = findPath(src, dst, rects);
	return pts ? rounded(pts) : bezier(src, dst);
}

function bezier(src: EdgeEnd, dst: EdgeEnd): Route {
	const [path, labelX, labelY] = getBezierPath({
		sourceX: src.x,
		sourceY: src.y,
		sourcePosition: src.position,
		targetX: dst.x,
		targetY: dst.y,
		targetPosition: dst.position,
	});
	return { path, labelX, labelY };
}

function isClearAhead(src: EdgeEnd, dst: EdgeEnd, rects: Rect[]) {
	if (src.position !== Position.Right || dst.position !== Position.Left) return false;
	const x1 = src.x + CLEAR;
	const x2 = dst.x - CLEAR;
	if (x2 <= x1) return false;
	const y1 = Math.min(src.y, dst.y);
	const y2 = Math.max(src.y, dst.y);
	return !rects.some((r) => r.x < x2 && r.x + r.w > x1 && r.y < y2 && r.y + r.h > y1);
}

const uniqSorted = (n: number[]) => [...new Set(n)].sort((a, b) => a - b);

/**
 * A* over the grid formed by the block edges (plus clearance) and the two
 * stubs. Every cell line is either clear or blocked end to end, so the grid is
 * small and the result is exact. Returns the corner points, or null if boxed in.
 */
function findPath(src: EdgeEnd, dst: EdgeEnd, rects: Rect[]): Pt[] | null {
	const d0 = OUT[src.position];
	const d1 = OUT[dst.position];
	const a = { x: src.x + STEPS[d0].x * STUB, y: src.y + STEPS[d0].y * STUB };
	const b = { x: dst.x + STEPS[d1].x * STUB, y: dst.y + STEPS[d1].y * STUB };
	const boxes = rects.map((r) => ({
		x: r.x - PAD,
		y: r.y - PAD,
		w: r.w + 2 * PAD,
		h: r.h + 2 * PAD,
	}));
	const xs = uniqSorted([
		a.x,
		b.x,
		a.x - LANE,
		a.x + LANE,
		b.x - LANE,
		b.x + LANE,
		...boxes.flatMap((r) => [r.x, r.x + r.w]),
	]);
	const ys = uniqSorted([
		a.y,
		b.y,
		a.y - LANE,
		a.y + LANE,
		b.y - LANE,
		b.y + LANE,
		...boxes.flatMap((r) => [r.y, r.y + r.h]),
	]);
	const blocked = (x: number, y: number) =>
		boxes.some((r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h);
	const ny = ys.length;
	const start = [xs.indexOf(a.x), ys.indexOf(a.y)];
	const goal = [xs.indexOf(b.x), ys.indexOf(b.y)];
	if (blocked(a.x, a.y) || blocked(b.x, b.y)) return null;

	// The way the route must be heading as it reaches the destination stub.
	const want = (d1 + 2) % 4;
	const state = (i: number, j: number, d: number) => (i * ny + j) * 4 + d;
	const cost = new Map<number, number>();
	const from = new Map<number, number>();
	const heap = new MinHeap();
	const h = (i: number, j: number) => Math.abs(xs[i] - b.x) + Math.abs(ys[j] - b.y);
	const s0 = state(start[0], start[1], d0);
	cost.set(s0, 0);
	heap.push(h(start[0], start[1]), s0);

	for (let cur = heap.pop(); cur !== undefined; cur = heap.pop()) {
		const d = cur % 4;
		const j = Math.floor(cur / 4) % ny;
		const i = Math.floor(cur / 4 / ny);
		if (i === goal[0] && j === goal[1]) return corners(from, cur, xs, ys, ny, src, dst, a, b);
		const g = cost.get(cur) as number;
		for (let nd = 0; nd < 4; nd++) {
			if (nd === (d + 2) % 4) continue;
			const ni = i + STEPS[nd].x;
			const nj = j + STEPS[nd].y;
			if (ni < 0 || nj < 0 || ni >= xs.length || nj >= ny) continue;
			if (blocked(xs[ni], ys[nj]) || blocked((xs[i] + xs[ni]) / 2, (ys[j] + ys[nj]) / 2)) continue;
			const turn = nd !== d ? BEND : 0;
			const arrive = ni === goal[0] && nj === goal[1] && nd !== want ? BEND : 0;
			const ng = g + Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + turn + arrive;
			const ns = state(ni, nj, nd);
			if (ng >= (cost.get(ns) ?? Number.POSITIVE_INFINITY)) continue;
			cost.set(ns, ng);
			from.set(ns, cur);
			heap.push(ng + h(ni, nj), ns);
		}
	}
	return null;
}

function corners(
	from: Map<number, number>,
	end: number,
	xs: number[],
	ys: number[],
	ny: number,
	src: Pt,
	dst: Pt,
	a: Pt,
	b: Pt,
): Pt[] {
	const chain: Pt[] = [];
	for (let s: number | undefined = end; s !== undefined; s = from.get(s)) {
		const cell = Math.floor(s / 4);
		chain.push({ x: xs[Math.floor(cell / ny)], y: ys[cell % ny] });
	}
	const all = [src, a, ...chain.reverse().slice(1, -1), b, dst];
	// Drop duplicate and collinear points so only real corners remain.
	return all.filter((p, k) => {
		const prev = all[k - 1];
		const next = all[k + 1];
		if (!prev || !next) return true;
		return (p.x - prev.x) * (next.y - p.y) !== (p.y - prev.y) * (next.x - p.x);
	});
}

const dist = (p: Pt, q: Pt) => Math.hypot(q.x - p.x, q.y - p.y);

/** Straight segments joined by quadratic arcs at every corner. */
function rounded(p: Pt[]): Route {
	let path = `M ${p[0].x} ${p[0].y}`;
	for (let k = 1; k < p.length - 1; k++) {
		const [prev, c, next] = [p[k - 1], p[k], p[k + 1]];
		const r = Math.min(RADIUS, dist(prev, c) / 2, dist(c, next) / 2);
		const inX = Math.sign(c.x - prev.x);
		const inY = Math.sign(c.y - prev.y);
		const outX = Math.sign(next.x - c.x);
		const outY = Math.sign(next.y - c.y);
		path += ` L ${c.x - inX * r} ${c.y - inY * r} Q ${c.x} ${c.y} ${c.x + outX * r} ${c.y + outY * r}`;
	}
	const last = p[p.length - 1];
	path += ` L ${last.x} ${last.y}`;

	let left = p.slice(1).reduce((n, q, k) => n + dist(p[k], q), 0) / 2;
	for (let k = 1; k < p.length; k++) {
		const len = dist(p[k - 1], p[k]);
		if (left <= len || k === p.length - 1) {
			const t = len ? left / len : 0;
			return {
				path,
				labelX: p[k - 1].x + (p[k].x - p[k - 1].x) * t,
				labelY: p[k - 1].y + (p[k].y - p[k - 1].y) * t,
			};
		}
		left -= len;
	}
	return { path, labelX: last.x, labelY: last.y };
}

/** Tiny binary min-heap of (priority, value). */
class MinHeap {
	private items: [number, number][] = [];
	push(priority: number, value: number) {
		const q = this.items;
		q.push([priority, value]);
		for (let i = q.length - 1; i > 0; ) {
			const parent = (i - 1) >> 1;
			if (q[parent][0] <= q[i][0]) break;
			[q[parent], q[i]] = [q[i], q[parent]];
			i = parent;
		}
	}
	pop(): number | undefined {
		const q = this.items;
		if (!q.length) return undefined;
		const top = q[0][1];
		const last = q.pop() as [number, number];
		if (q.length) {
			q[0] = last;
			for (let i = 0; ; ) {
				let m = i;
				for (const c of [2 * i + 1, 2 * i + 2]) if (c < q.length && q[c][0] < q[m][0]) m = c;
				if (m === i) break;
				[q[m], q[i]] = [q[i], q[m]];
				i = m;
			}
		}
		return top;
	}
}
