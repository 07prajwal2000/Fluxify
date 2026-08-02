import { describe, it, expect, spyOn, mock, afterEach } from "bun:test";
import * as serverModule from "@fluxify/server";
import { assertRunQuota } from "../rateLimit";

describe("Harness run quota", () => {
	afterEach(() => {
		mock.restore();
	});

	it("allows a request while the user is under the limit", async () => {
		spyOn(serverModule, "incrCache").mockResolvedValue(1);
		const expireSpy = spyOn(serverModule, "expireCache").mockResolvedValue(1);

		await assertRunQuota("user1");

		// The window only gets a TTL on the first hit — otherwise the counter is
		// pushed out on every request and never resets.
		expect(expireSpy).toHaveBeenCalledTimes(1);
	});

	it("does not re-arm the TTL on later hits in the same window", async () => {
		spyOn(serverModule, "incrCache").mockResolvedValue(7);
		const expireSpy = spyOn(serverModule, "expireCache").mockResolvedValue(1);

		await assertRunQuota("user1");

		expect(expireSpy).not.toHaveBeenCalled();
	});

	it("rejects with 429 once the user is over the limit", async () => {
		spyOn(serverModule, "incrCache").mockResolvedValue(31);
		spyOn(serverModule, "expireCache").mockResolvedValue(1);

		const error = await assertRunQuota("user1").catch((e) => e);
		expect(error).toBeInstanceOf(serverModule.HttpError);
		expect(error.httpCode).toBe(429);
	});

	it("fails open when Redis is unreachable", async () => {
		// A cache outage must not stop people using the product; the run's own
		// deadline and token budget still bound what one request can spend.
		spyOn(serverModule, "incrCache").mockRejectedValue(new Error("no redis"));

		expect(assertRunQuota("user1")).resolves.toBeUndefined();
	});
});
