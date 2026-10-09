/** The read tool and id argument that give the current state of what a save_*, delete_* or call_route tool targets. */
const READS: Record<string, [read: string, idKey: string]> = {
	save_route: ["get_route", "routeId"],
	save_workflow: ["get_workflow", "workflowId"],
	save_trigger: ["get_trigger", "triggerId"],
	save_custom_block: ["get_custom_block", "customBlockId"],
	save_middleware: ["get_middleware", "middlewareId"],
	save_integration: ["get_integration", "integrationId"],
	save_app_config: ["get_app_config", "appConfigId"],
	save_test_suite: ["get_test_suite", "testSuiteId"],
	call_route: ["get_route", "routeId"],
	delete_route: ["get_route", "routeId"],
	delete_workflow: ["get_workflow", "workflowId"],
	delete_trigger: ["get_trigger", "triggerId"],
	delete_custom_block: ["get_custom_block", "customBlockId"],
	delete_middleware: ["get_middleware", "middlewareId"],
	delete_integration: ["get_integration", "integrationId"],
	delete_app_config: ["get_app_config", "appConfigId"],
	delete_test_suite: ["get_test_suite", "testSuiteId"],
};

export const PREVIEWABLE = Object.keys(READS) as [string, ...string[]];

/**
 * A resource as it is now, read with the same get_* tool the agent uses, so the
 * card shows exactly what the agent would see. `null` for a create (no id yet).
 * An update diff needs it for the "before"; a delete card, for what goes.
 */
export async function currentResource(
	call: (name: string, args: unknown) => Promise<unknown>,
	projectId: string,
	tool: string,
	input: Record<string, unknown>,
) {
	const [read, idKey] = READS[tool];
	const id = input[idKey];
	if (id === undefined || id === null || id === "") return null;
	return call(read, { projectId, [idKey]: id });
}
