import type { SuiteInput } from "@fluxify/server/src/db/schema";
import type { TestSuiteDetail } from "@/services/testSuites";
import type { Assertion } from "./assertions";
import { DEFAULT_INPUT } from "./InputEditor";

export type BlockHook = NonNullable<TestSuiteDetail["hooks"]>[number];
export type HookBody = NonNullable<BlockHook["onBefore"]>;

/**
 * What the editor holds while a suite is open. The server DTO is fully partial
 * (every field optional), which is unusable as form state — this is the same
 * suite with the containers guaranteed present.
 */
export type SuiteDraft = {
	name: string;
	description: string;
	headers: Record<string, string>;
	queryParams: Record<string, string>;
	routeParams: Record<string, string>;
	/** null sends JSON */
	contentType: string | null;
	/** stored shape, see bodyCodec */
	body: unknown;
	assertions: Assertion[];
	appConfigOverrides: { key: string; value: string }[];
	integrationOverrides: { existingId: string; newId: string }[];
	hooks: BlockHook[];
	setupBlockId: string | null;
	teardownBlockId: string | null;
	setupTimeoutMs: number;
	teardownTimeoutMs: number;
	runAlone: boolean;
	/** workflow suites (#487): where the input comes from */
	input: SuiteInput;
};

export function toDraft(suite: TestSuiteDetail | undefined): SuiteDraft {
	return {
		name: suite?.name ?? "",
		description: suite?.description ?? "",
		headers: (suite?.headers as Record<string, string>) ?? {},
		queryParams: (suite?.queryParams as Record<string, string>) ?? {},
		routeParams: (suite?.routeParams as Record<string, string>) ?? {},
		contentType: suite?.contentType ?? null,
		body: suite?.body ?? null,
		assertions: (suite?.assertions as Assertion[]) ?? [],
		appConfigOverrides: suite?.appConfigOverrides ?? [],
		integrationOverrides: suite?.integrationOverrides ?? [],
		hooks: suite?.hooks ?? [],
		setupBlockId: suite?.setupBlockId ?? null,
		teardownBlockId: suite?.teardownBlockId ?? null,
		setupTimeoutMs: suite?.setupTimeoutMs ?? 30_000,
		teardownTimeoutMs: suite?.teardownTimeoutMs ?? 30_000,
		runAlone: suite?.runAlone ?? false,
		input: suite?.input ?? DEFAULT_INPUT,
	};
}
