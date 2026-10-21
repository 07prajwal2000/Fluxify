import { BUILT_IN_GROUP_LABELS, integrationRegistry } from "@fluxify/adapters/integrations";
import {
	isBuiltInIntegrationGroup,
	UnknownIntegrationVariantError,
} from "@fluxify/sdk/integrations";
import type { z } from "zod";
import { BadRequestError } from "../../../../errors/badRequestError";
import type { responseSchema } from "./dto";

export default function handleRequest(): z.infer<typeof responseSchema> {
	return integrationRegistry.groups().map((group) => ({
		group,
		label: isBuiltInIntegrationGroup(group) ? BUILT_IN_GROUP_LABELS[group] : group,
		builtIn: isBuiltInIntegrationGroup(group),
		variants: integrationRegistry.variants(group).map((def) => ({
			variant: def.variant,
			label: def.label,
			icon: def.icon,
			tags: [...(def.tags ?? [])],
			builtIn: integrationRegistry.isBuiltIn(group, def.variant),
			conditionEditor: def.group === "database" ? def.extras.conditionEditor : undefined,
		})),
	}));
}

/** The registered variant's config schema; an unknown one is a 400 that names it. */
export function variantConfigSchema(group: string, variant: string) {
	try {
		return integrationRegistry.require(group, variant).configSchema;
	} catch (error) {
		if (error instanceof UnknownIntegrationVariantError) throw new BadRequestError(error.message);
		throw error;
	}
}
