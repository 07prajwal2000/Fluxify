import { describe, it, expect, mock } from "bun:test";
import { JSONCodec } from "nats";

const codec = JSONCodec<unknown>();
let lastRequest: { subject: string; data: Uint8Array } | null = null;
let reply: Uint8Array = codec.encode({ ok: true, data: null });

mock.module("../nats", () => ({
	natsConnection: () => ({
		request: async (subject: string, data: Uint8Array) => {
			lastRequest = { subject, data };
			return { data: reply };
		},
	}),
}));

import { rpcRequest, RpcError, MAX_PAYLOAD_BYTES } from "../natsRpc";

const caller = { userId: "u1", projectIds: ["p1"] };
const isGzip = (b: Uint8Array) => b[0] === 0x1f && b[1] === 0x8b;
/** decode the way a responder would, so the test checks the actual wire format */
const readWire = (b: Uint8Array) =>
	codec.decode(isGzip(b) ? Bun.gunzipSync(b) : b) as any;

describe("natsRpc wire format", () => {
	it("sends small payloads as plain readable JSON", async () => {
		reply = codec.encode({ ok: true, data: { saved: true } });

		const result = await rpcRequest("fluxify.ops.canvas", caller, { id: "r1" });

		expect(isGzip(lastRequest!.data)).toBe(false);
		const sent = readWire(lastRequest!.data);
		expect(sent.caller).toEqual(caller);
		expect(sent.payload).toEqual({ id: "r1" });
		expect(sent.requestId).toBeTruthy();
		expect(result).toEqual({ saved: true } as any);
	});

	it("gzips a big canvas and still round-trips it", async () => {
		const blocks = Array.from({ length: 2000 }, (_, i) => ({
			id: `blk_${i}`,
			code: "return input.map(x => x);",
		}));
		reply = codec.encode({ ok: true, data: null });

		await rpcRequest("fluxify.ops.canvas", caller, { blocks });

		expect(isGzip(lastRequest!.data)).toBe(true);
		expect(readWire(lastRequest!.data).payload.blocks).toHaveLength(2000);
	});

	it("reads a gzipped response", async () => {
		reply = Bun.gzipSync(codec.encode({ ok: true, data: { big: "x" } }));

		expect(await rpcRequest("fluxify.ops.canvas", caller, {})).toEqual({
			big: "x",
		} as any);
	});

	it("refuses an oversized request instead of letting it time out", async () => {
		// random data so gzip cannot rescue it
		const filler = Array.from({ length: 400_000 }, () =>
			Math.random().toString(36).slice(2, 8),
		);

		const err = await rpcRequest("fluxify.ops.canvas", caller, {
			filler,
		}).catch((e) => e);

		expect(err).toBeInstanceOf(RpcError);
		expect(err.code).toBe("PAYLOAD_TOO_LARGE");
		expect(err.details.bytes).toBeGreaterThan(MAX_PAYLOAD_BYTES);
	});

	it("turns an error response into a typed throw", async () => {
		reply = codec.encode({
			ok: false,
			error: { code: "PARENT_NOT_FOUND", message: "Route not found" },
		});

		const err = await rpcRequest("fluxify.ops.canvas", caller, {}).catch(
			(e) => e,
		);

		expect(err.code).toBe("PARENT_NOT_FOUND");
		expect(err.message).toBe("Route not found");
	});
});
