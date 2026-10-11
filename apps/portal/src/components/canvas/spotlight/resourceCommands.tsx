import { TbBoxMultiple, TbFlask, TbGitFork, TbRoute } from "react-icons/tb";
import type { SpotlightCommand } from "./types";
import type { SpotlightResources } from "./useSpotlightResources";

export function buildResourceCommands({
	projectId,
	routes,
	workflows,
	customBlocks,
	sandboxes,
	onClose,
	navigate,
}: {
	projectId: string;
	routes: SpotlightResources["routes"];
	workflows: SpotlightResources["workflows"];
	customBlocks: SpotlightResources["customBlocks"];
	sandboxes: SpotlightResources["sandboxes"];
	onClose: () => void;
	navigate: (options: any) => void;
}): SpotlightCommand[] {
	const commands: SpotlightCommand[] = [];

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
				});
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
				});
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
				});
			},
		});
	}

	for (const sb of sandboxes) {
		commands.push({
			id: `resource-sandbox-${sb.id}`,
			title: `Sandbox: ${sb.name}`,
			subtitle: "Sandbox Canvas",
			category: "Resources",
			keywords: ["goto", "sandbox", sb.name],
			icon: <TbFlask size={15} />,
			onSelect: () => {
				onClose();
				navigate({
					to: "/$projectId/sandbox-canvas/$sandboxId",
					params: { projectId, sandboxId: sb.id },
				});
			},
		});
	}

	return commands;
}
