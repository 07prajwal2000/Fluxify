import type { ToolPart } from "../agentMessages";
import { rec, str } from "./data";
import { Notice } from "./Notice";
import { ResourceHeader } from "./ResourceHeader";

/** Previews test suite utility operations: validate_test_suite, clone_test_suite. */
export function SuiteActionPreview({ tool, asking }: { tool: ToolPart; asking: boolean }) {
	const input = rec(tool.input);
	const out = rec(tool.output);
	const suiteId = str(input.testSuiteId);

	if (tool.name === "validate_test_suite") {
		if (asking) {
			return (
				<Notice tone="warning">
					Checking assertions for test suite <strong>{suiteId}</strong> without running.
				</Notice>
			);
		}
		const valid = out.valid === true;
		const errors = Array.isArray(out.errors) ? out.errors : [];
		return (
			<div className="flex flex-col gap-2">
				<Notice tone={valid ? "info" : "danger"}>
					{valid
						? `Test suite ${suiteId} assertions are valid.`
						: `Test suite ${suiteId} assertions failed validation:`}
				</Notice>
				{errors.length > 0 && (
					<ul className="flex flex-col gap-1 text-xs text-danger">
						{errors.map((e, idx) => (
							<li key={idx}>
								{typeof e === "string" ? e : str((e as any)?.message || JSON.stringify(e))}
							</li>
						))}
					</ul>
				)}
			</div>
		);
	}

	// clone_test_suite
	const newId = str(out.id);
	const droppedHooks = Array.isArray(out.droppedHooks) ? (out.droppedHooks as string[]) : [];
	return (
		<div className="flex flex-col gap-2">
			{newId && (
				<ResourceHeader
					type="test_suite"
					id={newId}
					name={str(input.name) || `Suite ${newId.slice(0, 8)}`}
					badge="new"
				/>
			)}
			{asking && (
				<Notice tone="warning">
					This action will clone test suite <strong>{suiteId}</strong> to the target.
				</Notice>
			)}
			{droppedHooks.length > 0 && (
				<Notice tone="warning">
					Hooks with no matching blocks on target: {droppedHooks.join(", ")}
				</Notice>
			)}
		</div>
	);
}
