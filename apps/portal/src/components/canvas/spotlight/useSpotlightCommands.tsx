import { integrationIcons } from "@fluxify/components";
import {
	getIntegrationsGroups,
	getIntegrationsVariants,
	humanReadableConnectorNames,
} from "@fluxify/server/src/api/v1/integrations/helpers";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import {
	TbActivity,
	TbAdjustments,
	TbApi,
	TbBook,
	TbBoxMultiple,
	TbFilter,
	TbGitFork,
	TbHome,
	TbKeyboard,
	TbMoon,
	TbPlayerPlay,
	TbPlugConnected,
	TbPlus,
	TbPuzzle,
	TbRoute,
	TbSettings,
	TbSparkles,
	TbSun,
} from "react-icons/tb";
import { CustomBlockIcon } from "@/components/customBlocks/IconPicker";
import { withBasePath } from "@/constants/routes";
import { getTheme, toggleTheme } from "@/lib/theme";
import type { CanvasAction } from "../actions/useCanvasActions";
import { type BlockType, blockIcon, pickerBlockCatalogEntries } from "../blocks";
import { useAddableCustomBlockDefs } from "../blocks/useCustomBlockDefs";
import type { SpotlightCommand } from "./types";
import { useSpotlightResources } from "./useSpotlightResources";

export type UseSpotlightCommandsOptions = {
	actions: CanvasAction[];
	onAddBlock?: (type: BlockType) => void;
	enablePlayground?: boolean;
	onOpenPlayground?: () => void;
	onOpenShortcuts?: () => void;
	onClose: () => void;
	/** Open create pages in this tab. The canvas leaves it off so its unsaved edits survive. */
	inPlace?: boolean;
};

/** Leaves the canvas, and any unsaved edits on it, where they are. */
const openInNewTab = (path: string) =>
	window.open(withBasePath(path), "_blank", "noopener,noreferrer");

function actionDisabledReason(id: string): string | undefined {
	switch (id) {
		case "open":
			return "Requires 1 block selected";
		case "undo":
			return "Nothing to undo";
		case "redo":
			return "Nothing to redo";
		case "copy":
		case "duplicate":
		case "export":
			return "Requires blocks selected";
		case "delete":
			return "Requires selection to delete";
		default:
			return undefined;
	}
}

export function useSpotlightCommands({
	actions,
	onAddBlock,
	enablePlayground,
	onOpenPlayground,
	onOpenShortcuts,
	onClose,
	inPlace = false,
}: UseSpotlightCommandsOptions): SpotlightCommand[] {
	const navigate = useNavigate();
	const customDefs = useAddableCustomBlockDefs();
	const { projectId, routes, workflows, customBlocks } = useSpotlightResources();

	return useMemo(() => {
		const commands: SpotlightCommand[] = [];

		// 1. Canvas Actions
		for (const action of actions) {
			if (action.id === "spotlight") continue;
			commands.push({
				id: `canvas-${action.id}`,
				title: action.label,
				subtitle: "Canvas Action",
				category: "Actions",
				keywords: ["canvas", "action", action.id],
				icon: action.icon,
				shortcut: action.combo,
				disabled: action.disabled,
				disabledReason: action.disabled ? actionDisabledReason(action.id) : undefined,
				onSelect: () => {
					onClose();
					action.run();
				},
			});
		}

		// Playground action if enabled
		if (enablePlayground && onOpenPlayground) {
			commands.push({
				id: "canvas-playground",
				title: "Open API Playground",
				subtitle: "Canvas Tool",
				category: "Actions",
				keywords: ["playground", "api", "test", "run", "curl"],
				icon: <TbPlayerPlay size={15} />,
				shortcut: undefined,
				onSelect: () => {
					onClose();
					onOpenPlayground();
				},
			});
		}

		// Theme toggle action
		const currentTheme = getTheme();
		commands.push({
			id: "toggle-theme",
			title: currentTheme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
			subtitle: "Appearance • Theme",
			category: "Actions",
			keywords: ["theme", "dark", "light", "mode", "toggle", "color", "appearance", "switch"],
			icon: currentTheme === "dark" ? <TbSun size={15} /> : <TbMoon size={15} />,
			onSelect: () => {
				onClose();
				toggleTheme();
			},
		});

		// 2. Blocks (Catalog + Custom)
		if (onAddBlock) {
			for (const [type, def] of pickerBlockCatalogEntries()) {
				commands.push({
					id: `block-${type}`,
					title: `Add Block: ${def.name}`,
					subtitle: `Block • ${def.category}`,
					description: def.description,
					category: "Blocks",
					keywords: ["add", "block", type, def.name, def.category],
					icon: blockIcon(type),
					onSelect: () => {
						onClose();
						onAddBlock(type);
					},
				});
			}

			for (const def of customDefs) {
				commands.push({
					id: `custom-block-${def.id}`,
					title: `Add Block: ${def.label || def.name}`,
					subtitle: `Custom Block • ${def.sourceType === "plugin" ? "Built-in" : "Custom"}`,
					description: def.description ?? "Custom automation block",
					category: "Blocks",
					keywords: ["add", "block", "custom", def.name, def.label],
					icon: <CustomBlockIcon icon={def.icon} iconUrl={def.iconUrl} />,
					disabled: def.isSelf,
					disabledReason: def.isSelf
						? "A block cannot call itself — that would recurse forever."
						: undefined,
					onSelect: () => {
						onClose();
						onAddBlock(def.name as BlockType);
					},
				});
			}
		}

		// 3. Navigation (List Pages)
		if (projectId) {
			const navPages = [
				{
					id: "nav-routes",
					title: "Go to: API Routes",
					subtitle: "Navigation",
					keywords: ["goto", "nav", "routes", "api", "endpoints"],
					icon: <TbRoute size={15} />,
					to: "/$projectId/routes",
				},
				{
					id: "nav-workflows",
					title: "Go to: Workflows",
					subtitle: "Navigation",
					keywords: ["goto", "nav", "workflows", "background", "jobs"],
					icon: <TbGitFork size={15} />,
					to: "/$projectId/workflows",
				},
				{
					id: "nav-triggers",
					title: "Go to: Triggers",
					subtitle: "Navigation",
					keywords: ["goto", "nav", "triggers", "webhooks", "cron"],
					icon: <TbSparkles size={15} />,
					to: "/$projectId/triggers",
				},
				{
					id: "nav-app-config",
					title: "Go to: App Config",
					subtitle: "Navigation",
					keywords: ["goto", "nav", "config", "env", "environment", "variables"],
					icon: <TbAdjustments size={15} />,
					to: "/$projectId/app-config",
				},
				{
					id: "nav-integrations",
					title: "Go to: Integrations",
					subtitle: "Navigation",
					keywords: ["goto", "nav", "integrations", "connectors", "databases"],
					icon: <TbPuzzle size={15} />,
					to: "/$projectId/integrations",
				},
				{
					id: "nav-middlewares",
					title: "Go to: Middlewares",
					subtitle: "Navigation",
					keywords: ["goto", "nav", "middlewares", "auth", "before", "after"],
					icon: <TbFilter size={15} />,
					to: "/$projectId/middlewares",
				},
				{
					id: "nav-executions",
					title: "Go to: Executions",
					subtitle: "Navigation",
					keywords: ["goto", "nav", "executions", "runs", "history", "logs"],
					icon: <TbActivity size={15} />,
					to: "/$projectId/executions",
				},
				{
					id: "nav-custom-blocks",
					title: "Go to: Custom Blocks",
					subtitle: "Navigation",
					keywords: ["goto", "nav", "custom", "blocks"],
					icon: <TbBoxMultiple size={15} />,
					to: "/$projectId/custom-blocks",
				},
				{
					id: "nav-openapi",
					title: "Go to: OpenAPI",
					subtitle: "Navigation",
					keywords: ["goto", "nav", "openapi", "swagger", "spec", "docs"],
					icon: <TbApi size={15} />,
					to: "/$projectId/openapi",
				},
				{
					id: "nav-ai",
					title: "Go to: Fluxify AI",
					subtitle: "Navigation",
					keywords: ["goto", "nav", "ai", "assistant", "chat"],
					icon: <TbSparkles size={15} />,
					to: "/$projectId/ai",
				},
				{
					id: "nav-settings",
					title: "Go to: Project Settings",
					subtitle: "Navigation",
					keywords: ["goto", "nav", "settings", "project", "preferences"],
					icon: <TbSettings size={15} />,
					to: "/$projectId/settings",
				},
				{
					id: "nav-home",
					title: "Go to: Project Home",
					subtitle: "Navigation",
					keywords: ["goto", "nav", "home", "dashboard"],
					icon: <TbHome size={15} />,
					to: "/$projectId",
				},
			];

			for (const page of navPages) {
				commands.push({
					id: page.id,
					title: page.title,
					subtitle: page.subtitle,
					category: "Navigation",
					keywords: page.keywords,
					icon: page.icon,
					onSelect: () => {
						onClose();
						navigate({ to: page.to, params: { projectId } } as any);
					},
				});
			}

			const open = (to: string, search?: Record<string, string>) => {
				onClose();
				if (inPlace) {
					navigate({ to, params: { projectId }, search } as any);
					return;
				}
				const query = search ? `?${new URLSearchParams(search)}` : "";
				openInNewTab(`${to.replace("$projectId", projectId)}${query}`);
			};

			const createPages = [
				{ id: "route", label: "Route", icon: <TbRoute size={15} />, to: "/$projectId/routes/new" },
				{
					id: "workflow",
					label: "Workflow",
					icon: <TbGitFork size={15} />,
					to: "/$projectId/workflows/new",
				},
				{
					id: "trigger",
					label: "Trigger",
					icon: <TbSparkles size={15} />,
					to: "/$projectId/triggers/new",
				},
				{
					id: "middleware",
					label: "Middleware",
					icon: <TbFilter size={15} />,
					to: "/$projectId/middlewares/new",
				},
				{
					id: "custom-block",
					label: "Custom Block",
					icon: <TbBoxMultiple size={15} />,
					to: "/$projectId/custom-blocks/new",
				},
			];
			for (const page of createPages) {
				commands.push({
					id: `nav-new-${page.id}`,
					title: `Create ${page.label}`,
					subtitle: "New",
					category: "Navigation",
					keywords: ["new", "create", "add", page.id, page.label],
					icon: <TbPlus size={15} />,
					onSelect: () => open(page.to),
				});
			}

			commands.push({
				id: "nav-new-integration",
				title: "Create Integration",
				subtitle: "Connect a database, AI model, queue or other service",
				category: "Navigation",
				keywords: ["new", "create", "add", "connect", "integration", "connector"],
				icon: <TbPlugConnected size={15} />,
				onSelect: () => open("/$projectId/integrations/new"),
			});

			// One per connector; "Integrations" is left out of the default view,
			// so these only show up when searching.
			for (const group of getIntegrationsGroups()) {
				const groupName =
					humanReadableConnectorNames[group as keyof typeof humanReadableConnectorNames];
				for (const variant of getIntegrationsVariants(group)) {
					commands.push({
						id: `integration-new-${group}-${variant}`,
						title: `New Integration: ${variant}`,
						subtitle: groupName,
						category: "Integrations",
						keywords: ["new", "create", "connect", "integration", group, groupName],
						icon: integrationIcons[variant] ?? <TbPlugConnected size={15} />,
						onSelect: () => open("/$projectId/integrations/new", { group, variant }),
					});
				}
			}

			// 4. Resources (Switch Route / Workflow / Custom Block directly)
			for (const route of routes) {
				commands.push({
					id: `resource-route-${route.id}`,
					title: `Route: ${route.method} ${route.path}`,
					subtitle: route.name ? `API Route • ${route.name}` : "API Route",
					category: "Resources",
					keywords: ["goto", "route", route.method, route.path, route.name ?? ""],
					icon: <TbRoute size={15} />,
					onSelect: () => {
						onClose();
						navigate({
							to: "/$projectId/canvas/$routeId",
							params: { projectId, routeId: route.id },
						} as any);
					},
				});
			}

			for (const wf of workflows) {
				commands.push({
					id: `resource-workflow-${wf.id}`,
					title: `Workflow: ${wf.name}`,
					subtitle: `Workflow • ${wf.active ? "Active" : "Draft"}`,
					description: wf.description ?? undefined,
					category: "Resources",
					keywords: ["goto", "workflow", wf.name, wf.description ?? ""],
					icon: <TbGitFork size={15} />,
					onSelect: () => {
						onClose();
						navigate({
							to: "/$projectId/workflow-canvas/$workflowId",
							params: { projectId, workflowId: wf.id },
						} as any);
					},
				});
			}

			for (const cb of customBlocks) {
				commands.push({
					id: `resource-custom-block-${cb.id}`,
					title: `Custom Block: ${cb.label || cb.name}`,
					subtitle: "Custom Block Canvas",
					description: cb.description ?? undefined,
					category: "Resources",
					keywords: ["goto", "custom", "block", cb.name, cb.label ?? ""],
					icon: <TbBoxMultiple size={15} />,
					onSelect: () => {
						onClose();
						navigate({
							to: "/$projectId/custom-block-canvas/$blockId",
							params: { projectId, blockId: cb.id },
						} as any);
					},
				});
			}
		}

		// 5. Help / Documentation & Shortcuts
		if (onOpenShortcuts) {
			commands.push({
				id: "help-shortcuts",
				title: "Keyboard Shortcuts Manual",
				subtitle: "Help & Cheatsheet",
				description: "View all canvas keyboard shortcuts, commands, and mouse gestures",
				category: "Help",
				keywords: ["keyboard", "shortcuts", "cheatsheet", "hotkeys", "keys", "manual", "help", "?"],
				icon: <TbKeyboard size={15} />,
				shortcut: "?",
				onSelect: () => {
					onClose();
					onOpenShortcuts();
				},
			});
		}

		commands.push({
			id: "help-docs",
			title: "Open Documentation",
			subtitle: "External • docs.fluxify.rest",
			description: "Read docs for Fluxify canvas blocks and actions",
			category: "Help",
			keywords: ["docs", "documentation", "help", "guide", "manual"],
			icon: <TbBook size={15} />,
			onSelect: () => {
				onClose();
				window.open("https://docs.fluxify.rest/blocks/", "_blank", "noopener,noreferrer");
			},
		});

		return commands;
	}, [
		actions,
		onAddBlock,
		enablePlayground,
		onOpenPlayground,
		onOpenShortcuts,
		onClose,
		inPlace,
		customDefs,
		projectId,
		routes,
		workflows,
		customBlocks,
		navigate,
	]);
}
