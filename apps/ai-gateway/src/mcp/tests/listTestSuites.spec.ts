import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { AdminApi } from "../adminApi";
import { readTools } from "../tools";

const tool = readTools.find((t) => t.name === "list_test_suites")!;
const run = (args: object) => {
	const paths: string[] = [];
	const api = {
		get: async (path: string) => {
			paths.push(path);
			return [{ id: "s1", name: "n", description: "d", extra: 1 }];
		},
	} as unknown as AdminApi;
	return tool.call(api, z.object(tool.input).parse(args)).then((result) => ({ result, paths }));
};

describe("list_test_suites", () => {
	it("projectId alone lists every suite of the project", async () => {
		const { paths } = await run({ projectId: "p1" });
		expect(paths).toEqual(["/v1/test-suites/project/p1"]);
	});

	it("targetType + targetId still lists one target's suites", async () => {
		const { paths, result } = await run({ targetType: "route", targetId: "r1" });
		expect(paths).toEqual(["/v1/test-suites/route/r1"]);
		expect(result).toEqual([{ id: "s1", name: "n", description: "d" }]);
	});

	it("needs a project or a target", async () => {
		expect(run({})).rejects.toThrow("Pass projectId");
	});
});
