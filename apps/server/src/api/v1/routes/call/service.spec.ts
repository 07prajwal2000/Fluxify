import { afterAll, describe, expect, it } from "bun:test";
import { BadRequestError } from "../../../../errors/badRequestError";
import { fetchRoute, fillPath } from "./service";

describe("fillPath", () => {
	it("fills and encodes each :param", () => {
		expect(fillPath("/users/:id/posts/:postId", { id: "a b", postId: "7" })).toBe("/users/a%20b/posts/7");
		expect(fillPath("/health")).toBe("/health");
	});

	it("refuses a missing param", () => {
		expect(() => fillPath("/users/:id", {})).toThrow(BadRequestError);
	});
});

describe("fetchRoute", () => {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (req) => new Response(`${req.headers.get("host")} ${new URL(req.url).pathname}`),
	});
	afterAll(() => server.stop(true));

	it("dials 127.0.0.1 for a *.localhost host and keeps the name in Host", async () => {
		const res = await fetchRoute(new URL(`http://test.localhost:${server.port}/ping`), {});
		expect(await res.text()).toBe(`test.localhost:${server.port} /ping`);
	});

	it("leaves any other host alone", async () => {
		const res = await fetchRoute(new URL(`http://127.0.0.1:${server.port}/ping`), {});
		expect(await res.text()).toBe(`127.0.0.1:${server.port} /ping`);
	});
});
