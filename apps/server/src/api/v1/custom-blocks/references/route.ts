import { describeRoute, resolver, validator } from "hono-openapi";
import { z } from "zod";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { referencesResponseSchema } from "../../../../modules/references/dto";
import { listReferences } from "../../../../modules/references/service";
import type { HonoServer } from "../../../../types";
import { requireLoggedIn } from "../../../auth/middleware";

export default function (app: HonoServer) {
	app.get(
		"/:id/references",
		describeRoute({
			description:
				"Everything that uses this custom block: routes, workflows, other custom blocks, middlewares and test suite hooks. Each says whether its promoted version uses it. Sandboxes are not listed.",
			operationId: "get-custom-block-references",
			tags: ["Custom Blocks"],
			responses: {
				200: {
					description: "Successful",
					content: { "application/json": { schema: resolver(referencesResponseSchema) } },
				},
				400: {
					description: "Invalid id",
					content: { "application/json": { schema: resolver(validationErrorSchema) } },
				},
				404: {
					description: "Not found",
					content: { "application/json": { schema: resolver(errorSchema) } },
				},
			},
		}),
		requireLoggedIn(),
		validator("param", z.object({ id: z.string() }), zodErrorCallbackParser),
		async (ctx) =>
			ctx.json(
				await listReferences("custom_block", ctx.req.valid("param").id, ctx.get("acl") || []),
			),
	);
}
