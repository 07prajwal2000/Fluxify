import { describe, expect, it } from "bun:test";
import { type NatsConnection, NoRespondersError, RequestError } from "@nats-io/nats-core";
import { RpcError, rpcRequest } from "../rpc";

const failingWith = (error: Error) =>
	({
		request: async () => {
			throw error;
		},
	}) as unknown as NatsConnection;

describe("rpcRequest", () => {
	it("tells no responders apart from a timeout", async () => {
		const nc = failingWith(
			new RequestError("no responders", { cause: new NoRespondersError("s") }),
		);
		const error = (await rpcRequest(nc, "s", {}, { meta: undefined }).catch((e) => e)) as RpcError;
		expect(error).toBeInstanceOf(RpcError);
		expect(error.code).toBe("NO_RESPONDERS");
	});

	it("reports any other request failure as a timeout", async () => {
		const nc = failingWith(new Error("timeout"));
		const error = (await rpcRequest(nc, "s", {}, { meta: undefined }).catch((e) => e)) as RpcError;
		expect(error.code).toBe("TIMEOUT");
	});
});
