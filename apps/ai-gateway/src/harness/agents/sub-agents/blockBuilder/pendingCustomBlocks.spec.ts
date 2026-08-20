import { describe, expect, it } from "bun:test";
import { withCustomBlockPrefix } from "@fluxify/lib";
import { pendingCustomBlockSchemas } from "./pendingCustomBlocks";

/** The config agent emits a bare name; the create endpoint stores it prefixed,
 *  and that stored form is what a canvas must reference. */
const stored = withCustomBlockPrefix;

const task = (id: string, dependsOnAgentId: string[] = []) => ({
	id,
	title: id,
	description: "",
	dependsOnAgentId,
	status: "pending" as const,
	assignedAgentNode: "blockBuilder" as never,
});

const blockConfig = (name: string, action = "create") => ({
	action,
	customBlockId: `cb-${name}`,
	data: { name, inputParams: [{ name: "secret", type: "text_input" }] },
});

const state = (tasks: ReturnType<typeof task>[], results: Record<string, unknown>) =>
	({ orchestratorState: { tasks, subAgentResults: results } }) as never;

describe("pendingCustomBlockSchemas", () => {
	it("sees a block proposed by a task it declared a dependency on", () => {
		const map = pendingCustomBlockSchemas(
			state([task("cfg"), task("canvas", ["cfg"])], {
				cfg: blockConfig("jwt_validate"),
			}),
			"canvas",
		);
		expect(map.get(stored("jwt_validate"))).toEqual([
			{ name: "secret", type: "text_input" },
		]);
	});

	it("reaches a proposal one hop past its declared dependency", () => {
		// route canvas -> custom block canvas -> custom block config
		const map = pendingCustomBlockSchemas(
			state(
				[task("cfg"), task("blockCanvas", ["cfg"]), task("route", ["blockCanvas"])],
				{ cfg: blockConfig("jwt_validate") },
			),
			"route",
		);
		expect(map.has(stored("jwt_validate"))).toBe(true);
	});

	it("ignores a sibling it never declared a dependency on", () => {
		const map = pendingCustomBlockSchemas(
			state([task("cfg"), task("route")], { cfg: blockConfig("jwt_validate") }),
			"route",
		);
		expect(map.size).toBe(0);
	});

	it("ignores a block this run is deleting", () => {
		const map = pendingCustomBlockSchemas(
			state([task("cfg"), task("route", ["cfg"])], {
				cfg: blockConfig("jwt_validate", "delete"),
			}),
			"route",
		);
		expect(map.size).toBe(0);
	});

	it("terminates on a dependency cycle", () => {
		const map = pendingCustomBlockSchemas(
			state([task("a", ["b"]), task("b", ["a"])], { b: blockConfig("looped") }),
			"a",
		);
		expect(map.has(stored("looped"))).toBe(true);
	});
});
