import { describe, expect, it } from "bun:test";
import { requestBodySchema } from "../create/dto";
import { getSchema } from "../helpers";
import { requestRouteSchema as existing } from "../test-existing-connection/dto";

const good = "01a0d55a-841a-7880-a5e6-ef2b19bd6ae0";
const bad = "01a0d55a-841a-7880-a5e6-ef2b19bd6ae";

describe("integration ids", () => {
	it("rejects a garbled projectId or integration id with a clear message", () => {
		const r = existing.safeParse({ projectId: bad, id: good });
		expect(r.success).toBe(false);
		expect(r.error?.issues[0].message).toBe("Invalid projectId");
		const r2 = existing.safeParse({ projectId: good, id: "x" });
		expect(r2.error?.issues[0].message).toBe("Invalid integration id");
		expect(existing.safeParse({ projectId: good, id: good }).success).toBe(true);
	});

	it("accepts a Memcached url config", () => {
		const body = { name: "m", group: "kv", variant: "Memcached", config: {} };
		expect(requestBodySchema.safeParse(body).success).toBe(true);
		const cfg = getSchema("kv", "Memcached")!.safeParse({ source: "url", url: "localhost:11211" });
		expect(cfg.success).toBe(true);
	});
});
