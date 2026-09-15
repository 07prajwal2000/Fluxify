import { describe, it, expect, beforeEach, afterAll, spyOn } from "bun:test";
import * as redis from "../../db/redis";
import * as env from "../../lib/env";
import { adminRateLimit } from "../rateLimit";

// spyOn, not mock.module: module mocks are global to the whole `bun test` run
// and leak into every other spec that imports the same module.
const incrSpy = spyOn(redis, "incrCache");
const expireSpy = spyOn(redis, "expireCache");
const envSpy = spyOn(env, "getEnv");
afterAll(() => {
	incrSpy.mockRestore();
	expireSpy.mockRestore();
	envSpy.mockRestore();
});

function ctx(userId: string | null) {
	let status = 0;
	let headers: Record<string, string> = {};
	return {
		c: {
			get: () => (userId ? { id: userId } : null),
			json: (_body: unknown, s: number, h: Record<string, string>) => {
				status = s;
				headers = h;
				return "response";
			},
		} as any,
		result: () => ({ status, headers }),
	};
}

describe("adminRateLimit", () => {
	let counts: Record<string, number>;
	let passed: number;
	const next = async () => {
		passed++;
	};

	beforeEach(() => {
		counts = {};
		passed = 0;
		incrSpy.mockClear();
		envSpy.mockReturnValue("2" as any);
		expireSpy.mockResolvedValue(1);
		incrSpy.mockImplementation(async (key: string) => {
			counts[key] = (counts[key] ?? 0) + 1;
			return counts[key];
		});
	});

	it("allows requests up to the limit and blocks the next one", async () => {
		const { c, result } = ctx("user-1");

		await adminRateLimit(c, next);
		await adminRateLimit(c, next);
		expect(passed).toBe(2);
		expect(result().status).toBe(0);

		await adminRateLimit(c, next);
		expect(passed).toBe(2);
		expect(result().status).toBe(429);
		expect(result().headers["Retry-After"]).toBe("1");
	});

	it("counts each user separately", async () => {
		for (const user of ["a", "b", "c"]) {
			const { c } = ctx(user);
			await adminRateLimit(c, next);
			await adminRateLimit(c, next);
		}
		expect(passed).toBe(6);
	});

	it("skips anonymous requests and a zero limit", async () => {
		const anon = ctx(null);
		for (let i = 0; i < 5; i++) await adminRateLimit(anon.c, next);

		envSpy.mockReturnValue("0" as any);
		const user = ctx("user-2");
		for (let i = 0; i < 5; i++) await adminRateLimit(user.c, next);

		expect(passed).toBe(10);
		expect(incrSpy).not.toHaveBeenCalled();
	});

	it("fails open when redis errors", async () => {
		incrSpy.mockRejectedValue(new Error("redis down"));
		const { c, result } = ctx("user-3");
		for (let i = 0; i < 5; i++) await adminRateLimit(c, next);
		expect(passed).toBe(5);
		expect(result().status).toBe(0);
	});
});
