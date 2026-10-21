import { RpcError, type RpcResponder, rpcRespond } from "@fluxify/common/nats";
import { natsConnection, natsName } from "../../db/nats";
import { EncryptionService } from "../../lib/encryption";
import type { FluxifyEnv } from "../../lib/env";
import type { PluginIntegrationRef } from "../requestRouter/pluginIntegrations";
import type { PluginBlockRef } from "../requestRouter/pluginLoader";
import { testWorkerPool } from "./pool";
import { runSuiteInChild } from "./spawn";
import {
	TEST_RUN_QUEUE,
	type TestBootstrap,
	type TestResult,
	type TestRunRequest,
	testRunSubject,
} from "./types";

export type PluginCheckResult = { ok: true; refs: PluginBlockRef[] } | { ok: false; error: string };

/**
 * Checks that every plugin and block type the suite requires is installed on
 * this worker with the matching version and integrity. Returns the filtered
 * refs the suite needs, or a clear error if missing or mismatched.
 */
export function verifyPluginRequirements(
	bootstrap: TestBootstrap,
	workerRefs: PluginBlockRef[] = [],
): PluginCheckResult {
	if (!bootstrap.pluginBlocks?.length && !bootstrap.plugins) {
		return { ok: true, refs: [] };
	}

	const projectRefs = workerRefs.filter((r) => r.projectId === bootstrap.projectId);
	const byPlugin = new Map<string, PluginBlockRef[]>();
	const byType = new Map<string, PluginBlockRef>();

	for (const ref of projectRefs) {
		const list = byPlugin.get(ref.plugin) ?? [];
		list.push(ref);
		byPlugin.set(ref.plugin, list);
		byType.set(ref.type, ref);
	}

	// 1. Check each required plugin by name
	if (bootstrap.plugins) {
		for (const [pluginName, req] of Object.entries(bootstrap.plugins)) {
			const refs = byPlugin.get(pluginName);
			if (!refs || refs.length === 0) {
				return {
					ok: false,
					error: `plugin ${pluginName} ${req.version} isn't installed on this worker yet; retry when installation finishes`,
				};
			}
			const matches = refs.some(
				(ref) =>
					(ref.version === req.version || ref.version.startsWith(`${req.version}+`)) &&
					(!ref.integrity || ref.integrity === req.integrity),
			);
			if (!matches) {
				return {
					ok: false,
					error: `plugin ${pluginName} ${req.version} isn't installed on this worker yet; retry when installation finishes`,
				};
			}
		}
	}

	// 2. Collect refs for each required block type
	const neededRefs: PluginBlockRef[] = [];
	for (const type of bootstrap.pluginBlocks ?? []) {
		const ref = byType.get(type);
		if (!ref) {
			const pluginName = bootstrap.plugins
				? (Object.entries(bootstrap.plugins).find(([, req]) => req.blocks?.includes(type))?.[0] ??
					type)
				: type;
			const version = bootstrap.plugins?.[pluginName]?.version ?? "";
			const label = version ? `${pluginName} ${version}` : pluginName;
			return {
				ok: false,
				error: `plugin ${label} isn't installed on this worker yet; retry when installation finishes`,
			};
		}
		if (!neededRefs.some((r) => r.type === ref.type)) {
			neededRefs.push(ref);
		}
	}

	return { ok: true, refs: neededRefs };
}

/**
 * The worker half of a test run (#478): answers one project's suites, each in a
 * fresh child (`entry`), never in the live execution process — a suite's
 * overrides and draft code must not reach real traffic.
 *
 * The child gets the same environment as the execution process, so it resolves
 * the project's installed npm packages exactly as live routes do.
 */
export function serveTestRuns(
	projectId: string,
	entry: string,
	pluginRefs?: (() => PluginBlockRef[]) | FluxifyEnv,
	env?: FluxifyEnv,
	/** where this node's plugin integration variants are (I6); the suite's child loads the project's */
	integrationRefs: () => PluginIntegrationRef[] = () => [],
): RpcResponder {
	const getPluginRefs = typeof pluginRefs === "function" ? pluginRefs : undefined;
	const natsEnv = typeof pluginRefs === "string" ? pluginRefs : env;
	return rpcRespond<TestRunRequest, TestResult>(
		natsConnection(),
		natsName(testRunSubject(projectId), natsEnv),
		async ({ sealed }) => {
			const bootstrap: TestBootstrap = JSON.parse(EncryptionService.decrypt(sealed));
			// the subject already scopes it; a mismatch means a bug, not a request to honour
			if (bootstrap.projectId !== projectId) {
				throw new RpcError("FORBIDDEN", "Suite belongs to another project");
			}
			const check = verifyPluginRequirements(bootstrap, getPluginRefs?.() ?? []);
			if (!check.ok) {
				return {
					ok: false,
					error: check.error,
					durationMs: 0,
				};
			}
			bootstrap.pluginRefs = check.refs;
			bootstrap.pluginIntegrations = integrationRefs().filter((r) => r.projectId === projectId);
			return testWorkerPool.run(() => runSuiteInChild(bootstrap, entry));
		},
		{ queue: TEST_RUN_QUEUE },
	);
}
