import { beforeEach, describe, expect, it } from "bun:test";
import { forgetLags, LAG_STALE_MS, lagResponse, recordLag } from "../lagServe";
import { lagMetricsToken, lagPath, lagTargetOf, withoutLagTarget } from "../lagShared";

const ID = "0192b1c4-6666-7000-8000-000000000006";
// handed in, so the spec does not depend on whatever env another file left behind
const KEY = Buffer.alloc(32, 9).toString("base64");
const token = () => lagMetricsToken(KEY);
const ask = (id = ID, bearer: string | null = token(), at?: number) =>
	lagResponse(
		new Request(`http://worker:5601${lagPath(id)}`, {
			headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
		}),
		at,
		KEY,
	);

beforeEach(() => forgetLags());

describe("the worker's lag endpoint (#963)", () => {
	it("answers KEDA with the last number, as `lag`", async () => {
		recordLag(ID, 120);
		const response = ask()!;
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ lag: 120 });
	});

	it("answers 0 as 0: an empty backlog is a number, not an unknown", async () => {
		recordLag(ID, 0);
		expect(await ask()!.json()).toEqual({ lag: 0 });
	});

	it("is a 503 while the number is unknown, so KEDA counts a failed read and not an empty queue", () => {
		expect(ask()!.status).toBe(503);
		recordLag(ID, 4);
		recordLag(ID, null);
		expect(ask()!.status).toBe(503);
	});

	it("treats a number the child stopped refreshing as unknown", () => {
		const t0 = Date.now();
		recordLag(ID, 9, t0);
		expect(ask(ID, token(), t0 + LAG_STALE_MS - 1)!.status).toBe(200);
		expect(ask(ID, token(), t0 + LAG_STALE_MS + 1)!.status).toBe(503);
	});

	it("keeps one trigger's number from answering for another", () => {
		recordLag(ID, 1);
		expect(ask("0192b1c4-7777-7000-8000-000000000007")!.status).toBe(503);
	});

	it("asks for the token: none, a wrong one, or another scheme is a 401, whatever the number", () => {
		recordLag(ID, 1);
		expect(ask(ID, null)!.status).toBe(401);
		expect(ask(ID, "nope")!.status).toBe(401);
		expect(ask(ID, `${token()}x`)!.status).toBe(401);
		const basic = lagResponse(
			new Request(`http://w${lagPath(ID)}`, { headers: { authorization: `Basic ${token()}` } }),
			undefined,
			KEY,
		);
		expect(basic!.status).toBe(401);
	});

	it("answers nobody when the worker has no master key: there is nothing to check a token against", () => {
		recordLag(ID, 1);
		const request = new Request(`http://w${lagPath(ID)}`, { headers: { authorization: "Bearer x" } });
		expect(lagResponse(request, undefined, "")!.status).toBe(401);
		expect(lagResponse(request, undefined, undefined)!.status).toBe(401);
	});

	it("answers nobody when the worker has no master key: there is nothing to check a token against", () => {
		recordLag(ID, 1);
		const request = new Request(`http://w${lagPath(ID)}`, { headers: { authorization: "Bearer x" } });
		expect(lagResponse(request, undefined, "")!.status).toBe(401);
		const empty = new Request(`http://w${lagPath(ID)}`, { headers: { authorization: "Bearer " } });
		expect(lagResponse(empty, undefined, "")!.status).toBe(401);
	});

	it("leaves every other path to the health handler", () => {
		for (const path of ["/_/admin/api/healthchecks/ready", `/_/admin/api/triggers/${ID}`, "/", `/_/admin/api/triggers/a/b/lag`])
			expect(lagResponse(new Request(`http://w${path}`))).toBeNull();
	});
});

describe("what the worker and the orchestrator share", () => {
	it("derives the same token from the master key on both sides, and none without one", () => {
		const key = Buffer.alloc(32, 3).toString("base64");
		expect(lagMetricsToken(key)).toBe(lagMetricsToken(key));
		expect(lagMetricsToken(key)).toMatch(/^[0-9a-f]{64}$/);
		expect(lagMetricsToken(Buffer.alloc(32, 4).toString("base64"))).not.toBe(lagMetricsToken(key));
		expect(lagMetricsToken(undefined)).toBe("");
	});

	it("reads a stored lagPerWorker only when it is a whole number of at least 1", () => {
		expect(lagTargetOf({ lagPerWorker: 50 })).toBe(50);
		for (const bad of [0, -1, 1.5, "50", null, undefined])
			expect(lagTargetOf({ lagPerWorker: bad })).toBeUndefined();
		expect(lagTargetOf(null)).toBeUndefined();
	});

	it("reduces the target to 'is there one', so changing it restarts nothing", () => {
		const a = withoutLagTarget({ table: "t", lagPerWorker: 50 });
		expect(a).toEqual(withoutLagTarget({ table: "t", lagPerWorker: 5 }));
		expect(a).not.toEqual(withoutLagTarget({ table: "t" }));
		expect(withoutLagTarget(undefined)).toBeUndefined();
	});
});
