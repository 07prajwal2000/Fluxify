import type { TestSuiteDetail } from "@/services/testSuites";
import type { Assertion } from "./assertions";

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
	body: Record<string, unknown> | null;
	assertions: Assertion[];
	appConfigOverrides: { key: string; value: string }[];
	integrationOverrides: { existingId: string; newId: string }[];
};

export function toDraft(suite: TestSuiteDetail | undefined): SuiteDraft {
	return {
		name: suite?.name ?? "",
		description: suite?.description ?? "",
		headers: (suite?.headers as Record<string, string>) ?? {},
		queryParams: (suite?.queryParams as Record<string, string>) ?? {},
		routeParams: (suite?.routeParams as Record<string, string>) ?? {},
		body: (suite?.body as Record<string, unknown> | undefined) ?? null,
		assertions: (suite?.assertions as Assertion[]) ?? [],
		appConfigOverrides: suite?.appConfigOverrides ?? [],
		integrationOverrides: suite?.integrationOverrides ?? [],
	};
}
