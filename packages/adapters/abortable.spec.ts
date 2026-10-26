import { describe, expect, it } from "bun:test";
import { abortable } from "./abortable";

class Adapter {
	private rows = [1];
	/** a callable field, like a Bun `SQL` client */
	conn = Object.assign(() => "called", { release: () => "released" });
	pending = Promise.withResolvers<number[]>();
	get() {
		return this.pending.promise;
	}
	count() {
		return this.rows.length;
	}
	async rollbackTransaction() {
		return this.conn.release();
	}
}

describe("abortable", () => {
	it("is the target itself without a signal", () => {
		const adapter = new Adapter();
		expect(abortable(adapter, undefined)).toBe(adapter);
	});

	it("passes calls through while the signal is live", async () => {
		const adapter = new Adapter();
		const wrapped = abortable(adapter, new AbortController().signal);
		expect(wrapped.count()).toBe(1); // private fields still reached
		const pending = wrapped.get();
		adapter.pending.resolve([7]);
		expect(await pending).toEqual([7]);
	});

	it("rejects a pending call and refuses new ones once aborted, except kept cleanup", async () => {
		const adapter = new Adapter();
		const ctrl = new AbortController();
		const wrapped = abortable(adapter, ctrl.signal, new Set(["rollbackTransaction"]));
		const pending = wrapped.get();
		ctrl.abort(new Error("client gone"));
		await expect(pending).rejects.toThrow("client gone");
		expect(() => wrapped.get()).toThrow("client gone");
		// kept cleanup still reaches its callable fields (#1002's e2e hang)
		expect(await wrapped.rollbackTransaction()).toBe("released");
		expect(wrapped.conn).toBe(adapter.conn);
		adapter.pending.reject(new Error("late")); // settles quietly, no unhandled rejection
	});
});
