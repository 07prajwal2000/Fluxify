import { GoWorkflow } from "react-icons/go";
import { IoExtensionPuzzle } from "react-icons/io5";
import {
	TbActivity,
	TbBolt,
	TbCloudCog,
	TbFilter,
	TbFlask,
	TbSparkles,
	TbSquareKey,
	TbStack2,
} from "react-icons/tb";

/**
 * The sidebar: groups of links, a divider between groups. Routes, workflows and
 * triggers are the ways work gets started in a project and executions is the
 * record of what it did, so they sit together; integrations and app config are
 * the project's wiring and stay one group.
 */
export const NAV_GROUPS = [
	[{ key: "ai", label: "Fluxify AI", to: "/$projectId/ai", icon: TbSparkles }],
	[
		{ key: "routes", label: "Routes", to: "/$projectId/routes", icon: TbStack2 },
		{ key: "middlewares", label: "Middlewares", to: "/$projectId/middlewares", icon: TbFilter },
		{ key: "workflows", label: "Workflows", to: "/$projectId/workflows", icon: GoWorkflow },
		{ key: "triggers", label: "Triggers", to: "/$projectId/triggers", icon: TbBolt },
		{ key: "executions", label: "Executions", to: "/$projectId/executions", icon: TbActivity },
	],
	[
		{
			key: "custom-blocks",
			label: "Custom Blocks",
			to: "/$projectId/custom-blocks",
			icon: IoExtensionPuzzle,
		},
		// the server refuses a viewer, so the entry is not shown to one
		{
			key: "sandboxes",
			label: "Sandboxes",
			to: "/$projectId/sandboxes",
			icon: TbFlask,
			creator: true,
		},
	],
	[
		{
			key: "integrations",
			label: "Integrations",
			to: "/$projectId/integrations",
			icon: TbCloudCog,
		},
		{ key: "app-config", label: "App config", to: "/$projectId/app-config", icon: TbSquareKey },
	],
] as const;

/** Every page key — what the URL is matched against. */
export const NAV_KEYS: string[] = NAV_GROUPS.flat().map((item) => item.key);

/** The groups for someone who can or cannot edit: the server refuses a viewer on `creator` pages. */
export function visibleNavGroups(canEdit: boolean) {
	return NAV_GROUPS.map((group) => group.filter((item) => canEdit || !("creator" in item))).filter(
		(group) => group.length > 0,
	);
}

export const visibleNav = (canEdit: boolean) => visibleNavGroups(canEdit).flat();
