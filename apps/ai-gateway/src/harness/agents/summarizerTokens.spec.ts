import { describe, expect, it } from "bun:test";
import { enforceTokenAllowlist } from "./summarizerTokens";

const ROUTE = ':route{type="add" sub_artifact_id="sub-1"}';
const CANVAS =
	':canvasChanges{parent_type="artifact" parent="sub-1" artifact_id="sub-2"}';

describe("enforceTokenAllowlist", () => {
	it("keeps the tokens the harness issued", () => {
		const md = `Built it.\n- Added a route. ${ROUTE}\n- Wired the logic. ${CANVAS}`;
		expect(enforceTokenAllowlist(md, [ROUTE, CANVAS])).toBe(md);
	});

	it("drops a token the harness never issued, keeping the sentence", () => {
		// The injection case: a block description talks the model into emitting a
		// chip for a deletion that never happened.
		const out = enforceTokenAllowlist(
			`Removed the admin route. :route{type="delete" sub_artifact_id="evil"}`,
			[ROUTE],
		);
		expect(out).toBe("Removed the admin route.");
	});

	it("drops an altered id even when the shape is right", () => {
		const out = enforceTokenAllowlist(
			`Added a route. :route{type="add" sub_artifact_id="sub-99"}`,
			[ROUTE],
		);
		expect(out).not.toContain("sub-99");
	});

	it("keeps only the first use of a repeated token", () => {
		// Two buttons opening the same artifact means some other change lost its own.
		const out = enforceTokenAllowlist(
			`- One. ${ROUTE}\n- Two. ${ROUTE}`,
			[ROUTE],
		);
		expect(out.match(/:route\{/g)).toHaveLength(1);
		expect(out).toContain("- Two.");
	});

	it("leaves creation chips alone — the model authors those by design", () => {
		const md = 'Connect your database: :createIntegration{label="Tasks DB"}';
		expect(enforceTokenAllowlist(md, [])).toBe(md);
	});

	it("drops every reference token when the run produced no changes", () => {
		expect(
			enforceTokenAllowlist(`Nothing to do. ${ROUTE}`, []),
		).toBe("Nothing to do.");
	});
});
