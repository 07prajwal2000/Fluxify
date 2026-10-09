import { beforeAll, describe, expect, it, mock, spyOn } from "bun:test";

mock.module("../../../db", () => ({ db: {} }));

import { canvasBlockSchema, canvasChangesSchema } from "../types";
import * as repository from "../repository";
import { assignBlockKeys } from "../blockKeys";

// the real reserveBlockKeys, whatever the other canvas specs have spied on
beforeAll(() => mock.restore());

/** a transaction that holds a parent's counters, and records what is done to it */
function fakeTx(counters: Record<string, number> = {}) {
	const state = { counters, locks: 0, writes: 0 };
	const tx = {
		select: () => ({
			from: () => ({
				where: () => ({
					for: async (mode: string) => {
						if (mode === "update") state.locks++;
						return [{ counters: state.counters }];
					},
				}),
			}),
		}),
		update: () => ({
			set: (values: { blockKeyCounters: Record<string, number> }) => ({
				where: async () => {
					state.writes++;
					state.counters = values.blockKeyCounters;
				},
			}),
		}),
	};
	return { tx: tx as never, state };
}

const route = { type: "route" as const, id: "r-1" };

describe("reserveBlockKeys", () => {
	it("numbers each type from 1, in order", async () => {
		const { tx } = fakeTx();
		expect(
			await repository.reserveBlockKeys(
				route,
				["response", "db_insert", "response", "error_handler", "db_insert"],
				tx,
			),
		).toEqual(["response_1", "db_insert_1", "response_2", "error_handler_1", "db_insert_2"]);
	});

	it("continues from the counter, and keeps counting for the next save", async () => {
		const { tx, state } = fakeTx({ response: 2 });
		expect(await repository.reserveBlockKeys(route, ["response"], tx)).toEqual(["response_3"]);
		expect(state.counters).toEqual({ response: 3 });
		expect(await repository.reserveBlockKeys(route, ["response"], tx)).toEqual(["response_4"]);
	});

	it("does not reissue a number once its block is gone: only the counter decides", async () => {
		// response_1 and response_2 were created and both deleted; no block holds a key now
		const { tx } = fakeTx({ response: 2 });
		expect(await repository.reserveBlockKeys(route, ["response"], tx)).toEqual(["response_3"]);
	});

	it("locks the parent row while it moves the counter", async () => {
		const { tx, state } = fakeTx();
		await repository.reserveBlockKeys(route, ["if"], tx);
		expect(state).toMatchObject({ locks: 1, writes: 1 });
	});

	it("names a custom block custom_<name>, apart from a built-in of the same name", async () => {
		const { tx } = fakeTx();
		expect(
			await repository.reserveBlockKeys(
				route,
				["user_defined.project.send_mail", "user_defined.project.send_mail", "response"],
				tx,
			),
		).toEqual(["custom_send_mail_1", "custom_send_mail_2", "response_1"]);
	});

	it("touches nothing when there is no new block", async () => {
		const { tx, state } = fakeTx();
		expect(await repository.reserveBlockKeys(route, [], tx)).toEqual([]);
		expect(state).toMatchObject({ locks: 0, writes: 0 });
	});
});

describe("assignBlockKeys", () => {
	it("keeps a stored block's key and gives each new block the next one", async () => {
		spyOn(repository, "getBlocks").mockResolvedValue([
			{ id: "a", key: "response_1" },
			{ id: "b", key: "if_1" },
		] as never);
		const { tx } = fakeTx({ response: 1, if: 1 });
		const { keyOf, newKeys } = await assignBlockKeys(
			route,
			[
				{ id: "a", type: "response" },
				{ id: "c", type: "response" },
				{ id: "d", type: "if" },
			],
			tx,
		);
		expect([keyOf("a"), keyOf("c"), keyOf("d")]).toEqual(["response_1", "response_2", "if_2"]);
		expect(newKeys).toEqual({ c: "response_2", d: "if_2" });
	});
});

describe("a client cannot set a key", () => {
	it("is dropped from a saved block before it reaches the service", () => {
		const block = { id: "x", key: "response_9", type: "response", data: {}, position: { x: 0, y: 0 } };
		expect(canvasBlockSchema.parse(block)).not.toHaveProperty("key");
		const body = { actionsToPerform: { blocks: [], edges: [] }, changes: { blocks: [block], edges: [] } };
		expect(canvasChangesSchema.parse(body).changes.blocks[0]).not.toHaveProperty("key");
	});
});
