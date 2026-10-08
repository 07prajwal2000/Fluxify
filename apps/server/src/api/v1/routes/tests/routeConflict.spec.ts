import { describe, expect, it } from "bun:test";
import { routeConflictError } from "../routeConflict";

const wanted = { projectId: "p1", name: "get-user", method: "GET", path: "/users/:id" };
const clash = (over: object) => ({
	id: "r1",
	projectId: "p1",
	name: "other",
	method: "GET",
	path: "/users/:id",
	...over,
});

// #672: "route with name or path already exist" read as a path clash when only the name was taken
describe("routeConflictError", () => {
	it("names a taken name as the reason, not the path", () => {
		const e = routeConflictError(clash({ name: "get-user", method: "PUT" }), wanted);
		expect(e.httpCode).toBe(409);
		expect(e.message).toBe(
			'A route named "get-user" already exists in this project (PUT /users/:id). Route names are unique per project; pick another name.',
		);
	});

	it("says which route holds the method and path, and that other methods are fine", () => {
		expect(routeConflictError(clash({}), wanted).message).toBe(
			'GET /users/:id is already taken by route "other". Other methods on the same path are allowed.',
		);
	});

	it("explains a clash on a path with other param names", () => {
		const e = routeConflictError(clash({ path: "/users/:userId" }), wanted);
		expect(e.message).toContain("/users/:id and /users/:userId match the same requests");
	});

	it("does not name a route from another project", () => {
		const e = routeConflictError(clash({ projectId: "p2", name: "secret" }), wanted);
		expect(e.message).not.toContain("secret");
		expect(e.message).toContain("a route in another project");
	});
});
