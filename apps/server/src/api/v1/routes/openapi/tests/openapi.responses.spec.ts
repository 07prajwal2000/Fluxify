import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as redis from "../../../../../db/redis";
import * as instanceSettings from "../../../../../loaders/instanceSettingsLoader";
import * as repo from "../repository";
import { generateOpenApiSpec } from "../service";

const user = {
	dataType: "object",
	properties: [
		{ key: "id", dataType: "int", required: true },
		{ key: "email", dataType: "str", required: false },
	],
};

async function pathItem(route: Record<string, unknown>) {
	spyOn(repo, "getProject").mockResolvedValue({ id: "p1", name: "API" } as never);
	spyOn(repo, "getActiveRoutes").mockResolvedValue([
		{ id: "r1", method: "get", name: "Users", path: "/users", ...route },
	] as never);
	return (await generateOpenApiSpec({ projectId: "p1" }, "http://localhost:8080")).paths["/users"].get;
}

describe("OpenAPI responses from saved response schemas", () => {
	beforeEach(() => {
		spyOn(redis, "getCache").mockResolvedValue(null as never);
		spyOn(redis, "setCacheEx").mockResolvedValue(undefined);
		spyOn(instanceSettings, "configuredBaseDomain").mockReturnValue("");
		spyOn(instanceSettings, "baseDomain").mockReturnValue("localhost");
	});

	it("lists each saved status code with its schema, lowest first", async () => {
		const op = await pathItem({
			responseSchemas: [
				{ statusCode: 500, schema: { dataType: "object", properties: [] } },
				{ statusCode: 200, schema: user },
				{ statusCode: 404, schema: { dataType: "object", properties: [{ key: "error", dataType: "str" }] } },
			],
		});
		expect(Object.keys(op.responses)).toEqual(["200", "404", "500"]);
		expect(op.responses["200"].description).toBe("OK");
		expect(op.responses["404"].description).toBe("Not Found");
		expect(op.responses["200"].content["application/json"].schema).toEqual({
			type: "object",
			properties: { id: { type: "integer" }, email: { type: "string" } },
			required: ["id"],
		});
	});

	it("keeps the 200 placeholder when only other codes are saved", async () => {
		const op = await pathItem({ responseSchemas: [{ statusCode: 404, schema: user }] });
		expect(Object.keys(op.responses)).toEqual(["200", "404"]);
		expect(op.responses["200"]).toEqual({ description: "Successful response" });
	});

	it("keeps the placeholder for a route with no saved schemas", async () => {
		const op = await pathItem({ responseSchemas: [] });
		expect(op.responses).toEqual({ "200": { description: "Successful response" } });
	});
});
