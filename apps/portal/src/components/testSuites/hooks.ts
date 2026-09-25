import { type HookSupport, hookSupport, skipBranches } from "@fluxify/blocks/testHooks";
import { EXPECT_TYPES } from "./expectTypes";
import type { BlockHook } from "./types";

export type HookSlot = "onBefore" | "onAfter";

/** which hook kinds a block allows, mirrored from the server's check */
export function slotsFor(support: HookSupport): { slot: HookSlot; json: boolean }[] {
	if (support === "full") {
		return [
			{ slot: "onBefore", json: true },
			{ slot: "onAfter", json: true },
		];
	}
	return support === "input" ? [{ slot: "onBefore", json: false }] : [];
}

export { hookSupport };

/** a message per block whose JSON hook does not parse */
export function hookErrors(hooks: BlockHook[]): Map<string, string> {
	const errors = new Map<string, string>();
	for (const hook of hooks) {
		for (const slot of ["onBefore", "onAfter"] as const) {
			const body = hook[slot];
			if (body?.kind !== "json") continue;
			try {
				JSON.parse(body.value);
			} catch {
				errors.set(hook.blockId, `${slot}: invalid JSON`);
			}
		}
	}
	return errors;
}

export const HOOK_TEMPLATES: Record<HookSlot, string> = {
	onBefore: "// return a new input, call t.skip(output) to not run the block, or return nothing\n",
	onAfter: "// return a new output, or nothing to keep it\nreturn output;\n",
};

/** editor types for one hook; only one hook editor is mounted at a time, so the globals never clash */
export function hookTypes(slot: HookSlot, blockType: string) {
	const branches = skipBranches(blockType)
		.map((b) => JSON.stringify(b))
		.join(" | ");
	const skip =
		slot === "onBefore"
			? `  /** do not run the block; \`output\` flows on${branches ? ` down \`branch\` (default: the first)` : ""} */
  skip(output: unknown${branches ? `, branch?: ${branches}` : ""}): void;\n`
			: "";
	return `${EXPECT_TYPES}
/** the value flowing into the block */
declare const input: any;
${slot === "onAfter" ? "/** what the block returned */\ndeclare const output: any;\n" : ""}
declare const t: {
${skip}  /** fail the block: the route's error handler runs */
  fail(message: string): never;
  /** 1, 2, 3… how many times this block has run in this suite (loops) */
  call: number;
  /** the request's variables, readable and writable */
  vars: Record<string, any>;
  block: { id: string; type: string; name: string };
  /** unique per suite run: make seed data unique with it */
  runId: string;
  expect: Expect;
};
`;
}
