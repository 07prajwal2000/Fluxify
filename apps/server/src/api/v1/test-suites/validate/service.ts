import type { z } from "zod";
import type { testSuitesEntity } from "../../../../db/schema";
import type { AssertionType } from "../../../../modules/testRunner/assertions";
import { checkAssertions } from "../../../../modules/testRunner/validateSuite";
import type { requestBodySchema } from "./dto";
import { lastRunSample } from "./repository";

type Suite = typeof testSuitesEntity.$inferSelect;

export default async function handleRequest(
	suite: Suite,
	{ sample }: z.infer<typeof requestBodySchema>,
) {
	const source = sample ? "sample" : "last run";
	const response = sample ?? (await lastRunSample(suite.id));
	if (!response) {
		return {
			source: null,
			checked: 0,
			problems: [],
			message:
				"No recorded run to check against yet. Run the suite once, or pass a sample response.",
		};
	}
	const { checked, problems } = checkAssertions(
		(suite.assertions ?? []) as AssertionType[],
		response,
	);
	return {
		source,
		checked,
		problems,
		message: problems.length
			? `${problems.length} of ${checked} checks do not fit the ${source}`
			: `${checked} checks fit the ${source}`,
	} as const;
}
