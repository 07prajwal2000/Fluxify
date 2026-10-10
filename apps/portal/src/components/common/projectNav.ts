import {
	TbActivity,
	TbBolt,
	TbBox,
	TbCloudCog,
	TbFilter,
	TbFlask,
	TbRoute,
	TbSparkles,
	TbSquareKey,
	TbStack2,
} from "react-icons/tb";

/**
 * The sidebar, as a tree. Anything with `children` renders as a collapsible
 * group; everything else is a plain link. Routes, workflows and triggers are
 * the three ways work gets started in a project, and executions is the record
 * of what that work did — so they live together under one heading rather than
 * as four siblings of "Integrations".
 */
export const NAV = [
	{ key: "ai", label: "Fluxify AI", to: "/$projectId/ai", icon: TbSparkles },
	{
		key: "endpoints",
		label: "Endpoints & Automation",
		icon: TbBolt,
		children: [
			{ key: "routes", label: "Routes", to: "/$projectId/routes", icon: TbStack2 },
			{
				key: "middlewares",
				label: "Middlewares",
				to: "/$projectId/middlewares",
				icon: TbFilter,
			},
			{ key: "workflows", label: "Workflows", to: "/$projectId/workflows", icon: TbRoute },
			{ key: "triggers", label: "Triggers", to: "/$projectId/triggers", icon: TbBolt },
			{ key: "executions", label: "Executions", to: "/$projectId/executions", icon: TbActivity },
		],
	},
	{ key: "integrations", label: "Integrations", to: "/$projectId/integrations", icon: TbCloudCog },
	{ key: "app-config", label: "App config", to: "/$projectId/app-config", icon: TbSquareKey },
	{ key: "custom-blocks", label: "Custom Blocks", to: "/$projectId/custom-blocks", icon: TbBox },
	// the server refuses a viewer, so the entry is not shown to one
	{
		key: "sandboxes",
		label: "Sandboxes",
		to: "/$projectId/sandboxes",
		icon: TbFlask,
		creator: true,
	},
] as const;

/** Every page key, group children included — what the URL is matched against. */
export const NAV_KEYS: string[] = NAV.flatMap((item) =>
	"children" in item ? item.children.map((child) => child.key) : [item.key],
);

/** The sidebar for someone who can or cannot edit: the server refuses a viewer on `creator` pages. */
export function visibleNav(canEdit: boolean) {
	return NAV.filter((item) => canEdit || !("creator" in item));
}
