import { describeRoute, resolver, validator } from "hono-openapi";
import { licenseViewSchema, setLicenseBodySchema } from "./dto";
import { getLicenseView, setLicense } from "./service";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { errorSchema } from "../../../../errors/customError";
import { validationErrorSchema } from "../../../../errors/validationError";
import { HonoServer } from "../../../../types";
import { requireSystemAdmin } from "../../../auth/middleware";

const json = (schema: Parameters<typeof resolver>[0]) => ({
	content: { "application/json": { schema: resolver(schema) } },
});

const errors = {
	401: { description: "Unauthorized", ...json(errorSchema) },
	403: { description: "Forbidden", ...json(errorSchema) },
	500: { description: "Internal Server Error", ...json(errorSchema) },
};

export default function (app: HonoServer) {
	app.get(
		"/license",
		describeRoute({
			description: "The edition this instance runs, where it is set, and what it unlocks. Never includes the key.",
			operationId: "get-license",
			tags: ["Instance Settings"],
			responses: { 200: { description: "Successful", ...json(licenseViewSchema) }, ...errors },
		}),
		requireSystemAdmin,
		async (c) => c.json(await getLicenseView()),
	);

	app.put(
		"/license",
		describeRoute({
			description:
				"Switch the edition, or activate a license key. The key is verified before it is saved; the change reaches every worker without a restart. Refused while LICENSE_KEY is set in the environment.",
			operationId: "set-license",
			tags: ["Instance Settings"],
			responses: {
				200: { description: "Successful", ...json(licenseViewSchema) },
				400: { description: "Rejected key, or managed by the environment", ...json(validationErrorSchema) },
				...errors,
			},
		}),
		requireSystemAdmin,
		validator("json", setLicenseBodySchema, zodErrorCallbackParser),
		async (c) => {
			const user = c.get("user") as { id: string };
			return c.json(await setLicense(c.req.valid("json"), user.id));
		},
	);
}
