import { expect, it } from "bun:test";
import { parseApiError } from "./errorNotifier";

const axiosError = (response?: { status: number; data: unknown }) => ({ isAxiosError: true, response });

it("reads the `errors` validation shape", () => {
	const r = parseApiError(axiosError({ status: 400, data: { type: "validation", errors: [{ field: "name", message: "Required" }] } }));
	expect(r.fieldErrors).toEqual([{ field: "name", message: "Required" }]);
	expect(r.message).toBe("Required");
});

it("reads the legacy `error` shape and drops empty fields", () => {
	const r = parseApiError(axiosError({ status: 400, data: { type: "validation", error: [{ field: "", message: "Bad body" }] } }));
	expect(r.fieldErrors).toEqual([{ field: undefined, message: "Bad body" }]);
});

it("reads a `message` body", () => {
	expect(parseApiError(axiosError({ status: 409, data: { message: "Name taken" } }))).toEqual({
		status: 409,
		message: "Name taken",
		fieldErrors: undefined,
	});
});

it("falls back to the status name for an HTML proxy page", () => {
	expect(parseApiError(axiosError({ status: 502, data: "<html>bad gateway</html>" })).message).toBe("502 Bad Gateway");
});

it("reports a missing response as a network error", () => {
	expect(parseApiError(axiosError()).message).toBe("Network error, check your connection");
});

it("never throws on odd input", () => {
	expect(parseApiError(axiosError({ status: 400, data: { type: "validation", errors: "nope" } })).message).toBe("400 Bad Request");
	expect(parseApiError(axiosError({ status: 400, data: null })).message).toBe("400 Bad Request");
	expect(parseApiError(undefined).message).toBe("Unknown error occurred");
	expect(parseApiError(new Error("boom")).message).toBe("boom");
});
