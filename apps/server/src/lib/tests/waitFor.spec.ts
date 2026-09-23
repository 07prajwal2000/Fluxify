import { describe, expect, it } from "bun:test";
import { waitFor } from "../waitFor";

/** A connect function that fails `failures` times, then returns "up". */
function flaky(failures: number) {
	let calls = 0;
	const connect = async () => {
		calls++;
		if (calls <= failures) throw new Error("connection refused");
		return "up";
	};
	return { connect, calls: () => calls };
}

describe("waitFor", () => {
	it("returns at once when the dependency is already up", async () => {
		const dep = flaky(0);
		expect(await waitFor("NATS", dep.connect, 3, 0)).toBe("up");
		expect(dep.calls()).toBe(1);
	});

	it("keeps trying until the dependency comes up", async () => {
		const dep = flaky(4);
		expect(await waitFor("NATS", dep.connect, 5, 0)).toBe("up");
		expect(dep.calls()).toBe(5);
	});

	it("gives up after the last attempt and names what is missing", async () => {
		const dep = flaky(10);
		await expect(waitFor("Postgres", dep.connect, 3, 0)).rejects.toThrow(
			"Postgres is not reachable after 3 attempts: Error: connection refused",
		);
		expect(dep.calls()).toBe(3);
	});
});
