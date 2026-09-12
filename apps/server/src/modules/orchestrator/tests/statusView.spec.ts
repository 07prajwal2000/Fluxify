import { describe, expect, it } from "bun:test";
import { groupPair } from "@fluxify/common/orchestrator";
import type { DesiredNode } from "../projection";
import {
	buildClaimViews,
	groupAlarms,
	poolUsage,
	type ActiveGroup,
	type ClaimRow,
	type Heartbeat,
	type NodeRow,
	type NodeView,
} from "../statusView";

/**
 * The display rules, which are the only decisions on the read path: which of
 * three sources wins for a node's state, and whether a group with work has
 * anything healthy serving it.
 */

const CLAIM_ID = "0192b1c4-1111-7000-8000-000000000001";

const claim = (over: Partial<ClaimRow> = {}): ClaimRow => ({
	id: CLAIM_ID,
	projectId: "proj-a",
	type: "workflow",
	groupIds: ["grp-1"],
	replicas: 1,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	...over,
});

const desired = (over: Partial<DesiredNode> = {}): DesiredNode => ({
	claimId: CLAIM_ID,
	replicaIndex: 0,
	projectId: "proj-a",
	type: "workflow",
	groupIds: ["grp-1"],
	excludedGroups: [],
	placeable: true,
	reason: null,
	...over,
});

const row = (over: Partial<NodeRow> = {}): NodeRow => ({
	id: `${CLAIM_ID}.0`,
	claimId: CLAIM_ID,
	replicaIndex: 0,
	projectId: "proj-a",
	state: "ready",
	reason: null,
	image: "fluxify/worker:1",
	containerId: "abc123",
	updatedAt: new Date("2026-01-01T00:00:05Z"),
	...over,
});

const beats = (...entries: [string, Heartbeat][]) => new Map(entries);
const live: Heartbeat = { ready: true, at: "2026-01-01T00:00:09Z" };

const one = (input: {
	desired?: DesiredNode;
	rows?: NodeRow[];
	heartbeats?: Map<string, Heartbeat>;
}) =>
	buildClaimViews({
		claims: [claim()],
		desired: [input.desired ?? desired()],
		rows: input.rows ?? [],
		heartbeats: input.heartbeats ?? new Map(),
	})[0]!.nodes[0]!;

describe("what a node's state is shown as", () => {
	it("is ready when the worker's own heartbeat says it is serving", () => {
		const node = one({ rows: [row({ state: "starting" })], heartbeats: beats([`${CLAIM_ID}.0`, live]) });
		// The row is a reconcile pass old and the heartbeat is seconds old, so a
		// node that just came up must not read `starting` for another pass.
		expect(node.state).toBe("ready");
		expect(node.live).toBe(true);
		expect(node.serving).toBe(true);
	});

	it("is starting while the node is alive but not yet serving", () => {
		const node = one({
			rows: [row()],
			heartbeats: beats([`${CLAIM_ID}.0`, { ready: false, at: live.at }]),
		});
		expect(node.state).toBe("starting");
	});

	it("is unhealthy when the container is up and the process has gone quiet", () => {
		const node = one({ rows: [row({ state: "ready" })] });
		expect(node.state).toBe("unhealthy");
		expect(node.reason).toBe("heartbeat_stale");
		expect(node.live).toBe(false);
	});

	it("is pending when the projection refuses it, whatever the row says", () => {
		const node = one({
			desired: desired({ placeable: false, reason: "pool_unavailable" }),
			rows: [row()],
			heartbeats: beats([`${CLAIM_ID}.0`, live]),
		});
		expect(node.state).toBe("pending");
		expect(node.reason).toBe("pool_unavailable");
	});

	it("is pending, not failed, when no pass has happened yet", () => {
		// Kit, or a stack before its first reconcile: no rows exist and inventing
		// a failure would blame the operator for a loop that has not run.
		const node = one({});
		expect(node.state).toBe("pending");
		expect(node.reason).toBeNull();
	});

	it("passes the row's own failure through", () => {
		const node = one({ rows: [row({ state: "failed", reason: "image_pull_failed" })] });
		expect(node.state).toBe("failed");
		expect(node.reason).toBe("image_pull_failed");
	});
});

describe("claims and their replicas", () => {
	it("groups replicas under their claim in replica order", () => {
		const views = buildClaimViews({
			claims: [claim({ replicas: 2 })],
			desired: [desired({ replicaIndex: 1 }), desired({ replicaIndex: 0 })],
			rows: [],
			heartbeats: new Map(),
		});
		expect(views[0]!.nodes.map((node) => node.replicaIndex)).toEqual([0, 1]);
		expect(views[0]!.nodes.map((node) => node.id)).toEqual([`${CLAIM_ID}.0`, `${CLAIM_ID}.1`]);
	});

	it("counts the pool against the ceiling, not against containers", () => {
		expect(
			poolUsage(
				[desired(), desired({ replicaIndex: 1, placeable: false, reason: "pool_unavailable" })],
				1,
			),
		).toEqual({ placed: 1, requested: 2, ceiling: 1 });
	});
});

describe("the alarm for a group with work and nothing healthy", () => {
	const group: ActiveGroup = {
		projectId: "proj-a",
		groupId: "grp-1",
		groupName: "orders",
		activeTriggers: 2,
	};
	const node = (over: Partial<NodeView> = {}): NodeView => ({
		...one({}),
		type: "workflow",
		projectId: "proj-a",
		groupIds: ["grp-1"],
		excludedGroups: [],
		serving: true,
		live: true,
		...over,
	});

	it("stays silent when a serving node covers the group", () => {
		expect(groupAlarms([group], [node()])).toEqual([]);
	});

	it("stays silent for a catch-all node with no groups, which serves every unowned group", () => {
		expect(groupAlarms([group], [node({ projectId: null, groupIds: [] })])).toEqual([]);
	});

	it("fires when the node that claims the group is not serving", () => {
		const [alarm] = groupAlarms([group], [node({ serving: false })]);
		expect(alarm).toMatchObject({ groupId: "grp-1", activeTriggers: 2, claimedNodes: 1 });
	});

	it("fires with no claimed nodes when nothing covers the group at all", () => {
		const [alarm] = groupAlarms([group], [node({ groupIds: ["grp-other"] })]);
		expect(alarm!.claimedNodes).toBe(0);
	});

	it("does not count a catch-all node for a pair a dedicated claim already owns", () => {
		const excluded = node({
			projectId: null,
			groupIds: [],
			excludedGroups: [groupPair("proj-a", "grp-1")],
		});
		expect(groupAlarms([group], [excluded])[0]!.claimedNodes).toBe(0);
	});

	it("never counts a route node — it serves no groups", () => {
		expect(groupAlarms([group], [node({ type: "route" })])[0]!.claimedNodes).toBe(0);
	});

	it("ignores another project's node", () => {
		expect(groupAlarms([group], [node({ projectId: "proj-b" })])[0]!.claimedNodes).toBe(0);
	});
});
