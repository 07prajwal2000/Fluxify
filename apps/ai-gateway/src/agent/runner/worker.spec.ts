import { afterAll, describe, expect, it, spyOn } from "bun:test";
import * as store from "../store";

// The gateway imports the worker before drizzleInit sets `db`: a store built
// at import time keeps the null db and every job fails on `db.update`.
const built = spyOn(store, "agentStore");
afterAll(() => built.mockRestore());

describe("agent worker deps", () => {
	it("builds the store per job, not when the module loads", async () => {
		const { deps } = await import("./worker");
		expect(built).not.toHaveBeenCalled();
		const db = (await import("@fluxify/server")).db;
		void deps.store;
		expect(built).toHaveBeenCalledTimes(1);
		expect(built.mock.calls[0][0]).toBe(db);
	});
});
