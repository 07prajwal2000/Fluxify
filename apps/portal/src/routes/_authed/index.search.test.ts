import { expect, test } from "bun:test";
import type { ZodType } from "zod";
import { Route } from "./index";

const validate = (search: Record<string, unknown>) =>
	(Route.options.validateSearch as ZodType<{ project?: string }>).parse(search);

test("the audit page's project filter is read from ?project=", () => {
	expect(validate({ tab: "instance", settingsTab: "audit", project: "p1" })).toMatchObject({
		project: "p1",
	});
});

test("a project that is not a short string is dropped, not an error", () => {
	expect(validate({ project: 7 }).project).toBeUndefined();
	expect(validate({ project: "x".repeat(51) }).project).toBeUndefined();
	expect(validate({}).project).toBeUndefined();
});
