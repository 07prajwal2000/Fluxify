import { useEffect } from "react";

const ID = "fluxify-testsuite-global";
const VIRTUAL_PATH = "file:///fluxify-testsuite-global.d.ts";

/** What a test-only custom block sees while it runs as a suite's setup or teardown (#483). */
export const TESTSUITE_TYPE_LIB = `/** The test suite this block is running for, as its setup or teardown. */
declare const testsuite: {
  /** "setup" runs before the suite's request, "teardown" after it. */
  phase: "setup" | "teardown";
  /** Unique per suite run: put it in seed data so parallel suites never clash. */
  runId: string;
  suite: { id: string; name: string };
  /** Teardown only: what the setup block returned. */
  setup?: any;
  /** Teardown only: how the suite ended. */
  outcome?: "passed" | "failed" | "error" | "timeout";
};
`;

/**
 * Registers the `testsuite` global while `enabled` — only a test-only custom
 * block's canvas turns it on, so no other editor offers it.
 */
export function useTestSuiteGlobalTypes(enabled: boolean) {
	useEffect(() => {
		if (!enabled) return;
		let live = true;
		const registry = import("./typeLibRegistry");
		void registry.then((module) => {
			if (live) module.registerTypeLib(ID, TESTSUITE_TYPE_LIB, VIRTUAL_PATH);
		});
		return () => {
			live = false;
			void registry.then((module) => module.unregisterTypeLib(ID));
		};
	}, [enabled]);
}
