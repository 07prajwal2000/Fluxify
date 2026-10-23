import { BUILT_IN_GROUP_LABELS, integrationRegistry } from "@fluxify/adapters/integrations";
import {
	isBuiltInIntegrationGroup,
	UnknownIntegrationVariantError,
} from "@fluxify/sdk/integrations";
import { z } from "zod";
import { BadRequestError } from "../../../../errors/badRequestError";
import { dataIcon } from "../../../../modules/plugins/sources/icons";
import { isPluginVariantDisabled } from "../../../../modules/plugins/variants";
import type { responseSchema } from "./dto";

/**
 * Every group and variant the project can create: the built-ins, and its
 * approved plugins' variants (I6) with the plugin that provides each, so the
 * portal can group them. A plugin switched off everywhere is left out.
 */
export default function handleRequest(projectId: string): z.infer<typeof responseSchema> {
	const groups = integrationRegistry.groups(projectId).map((group) => ({
		group,
		label: isBuiltInIntegrationGroup(group) ? BUILT_IN_GROUP_LABELS[group] : group,
		builtIn: isBuiltInIntegrationGroup(group),
		...(!isBuiltInIntegrationGroup(group) && { namespace: group.split("/")[0] }),
		variants: integrationRegistry
			.variants(group, projectId)
			.filter((def) => !isPluginVariantDisabled(projectId, group, def.variant))
			.map((def) => {
				let configSchema: Record<string, unknown> | undefined;
				try {
					configSchema = z.toJSONSchema(def.configSchema, {
						io: "input",
						unrepresentable: "any",
					}) as Record<string, unknown>;
				} catch {
					// safe fallback
				}
				const builtIn = integrationRegistry.isBuiltIn(group, def.variant);
				return {
					variant: def.variant,
					label: def.label,
					// a plugin's icon is a data URL or nothing, whatever registered the variant
					icon: def.plugin ? dataIcon(def.icon) : def.icon,
					tags: [...(def.tags ?? [])],
					builtIn,
					...(def.plugin && { plugin: def.plugin, namespace: def.plugin.split("/")[0] }),
					conditionEditor: def.group === "database" ? def.extras.conditionEditor : undefined,
					params: def.params,
					tabs: def.tabs ? [...def.tabs] : undefined,
					hasTest:
						def.hasTest ??
						(builtIn && ["database", "kv", "ai", "observability", "queue"].includes(def.group)),
					hasDescribe: def.hasDescribe ?? (builtIn && def.group === "database"),
					hasInspect: def.hasInspect ?? (builtIn && ["database", "kv"].includes(def.group)),
					description: def.description,
					docs: def.docs,
					configSchema,
				};
			}),
	}));
	// a plugin's own group whose every variant is switched off has nothing to create
	return groups.filter((g) => g.builtIn || g.variants.length);
}

/**
 * The registered variant's config schema; an unknown one is a 400 that names
 * it. `create`: a plugin variant switched off everywhere takes no new rows.
 */
export function variantConfigSchema(
	group: string,
	variant: string,
	projectId?: string,
	{ create = false } = {},
) {
	try {
		const def = integrationRegistry.require(group, variant, projectId);
		if (create && projectId && isPluginVariantDisabled(projectId, group, def.variant))
			throw new BadRequestError(
				`Integration variant "${group}/${variant}" belongs to a disabled plugin; enable the plugin to create one`,
			);
		return def.configSchema;
	} catch (error) {
		if (error instanceof UnknownIntegrationVariantError) throw new BadRequestError(error.message);
		throw error;
	}
}
