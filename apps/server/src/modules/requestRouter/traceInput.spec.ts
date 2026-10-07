import { expect, test } from "bun:test";
import { requestTraceInput } from "./traceInput";

test("the entrypoint input holds the whole request", () => {
	const input = requestTraceInput({
		method: "GET",
		path: "/users/7",
		headers: { Host: "api.test", cookie: "sid=abc; theme=dark", "x-key": "k" },
		query: { q: "a b", tag: ["x", "y"] },
		body: null,
		params: { id: "7" },
	});
	expect(input).toEqual({
		method: "GET",
		url: "http://api.test/users/7?q=a+b&tag=x&tag=y",
		path: "/users/7",
		host: "api.test",
		query: { q: "a b", tag: ["x", "y"] },
		params: { id: "7" },
		headers: { Host: "api.test", cookie: "sid=abc; theme=dark", "x-key": "k" },
		cookies: { sid: "abc", theme: "dark" },
		body: null,
	});
	// the real URL wins when the request has one
	expect(requestTraceInput({ ...input, headers: {} }, "https://x.test/u?a=1").url).toBe(
		"https://x.test/u?a=1",
	);
});
