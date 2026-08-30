import { describe, expect, it } from "bun:test";
import { BlockTypes } from "./blockTypes";
import { compileGraph } from "./compiler";

const block = (id: string, type: string, data: any = {}) => ({
	id,
	type,
	position: { x: 0, y: 0 },
	data,
});
const edge = (from: string, to: string) => ({
	id: `${from}-${to}`,
	from,
	to,
	fromHandle: "source",
	toHandle: "source",
});

const graph = [
	[
		block("1", BlockTypes.entrypoint),
		block("2", BlockTypes.response, { httpCode: "201" }),
	],
	[edge("1", "2")] as any,
] as const;

describe("response block under asWorkflow", () => {
	it("emits the status code for a route", () => {
		const { source } = compileGraph(graph[0] as any, graph[1]);
		expect(source).toContain("httpCode");
		expect(source).toContain('"201"');
	});

	it("emits nothing of the response for a workflow", () => {
		const { source } = compileGraph(graph[0] as any, graph[1], {
			asWorkflow: true,
		});
		// nobody is holding a connection open, so a status code would be a field
		// no caller can ever read
		expect(source).not.toContain("httpCode");
		expect(source).not.toContain('"201"');
	});

	it("still ends the run, carrying the last value out", () => {
		const { source } = compileGraph(graph[0] as any, graph[1], {
			asWorkflow: true,
		});
		expect(source).toContain("successful: true");
	});
});
