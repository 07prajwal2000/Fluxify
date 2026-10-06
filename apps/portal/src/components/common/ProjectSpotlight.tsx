import { integrationIcons } from "@fluxify/components";
import { humanReadableConnectorNames } from "@fluxify/server/src/api/v1/integrations/helpers";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TbHome, TbLogout, TbPlugConnected, TbSwitchHorizontal } from "react-icons/tb";
import { matchCombo } from "@/components/canvas/actions/combo";
import {
	CanvasSpotlight,
	type SpotlightCommand,
	useSpotlightCommands,
} from "@/components/canvas/spotlight";
import { integrationsQuery } from "@/query/integrationsQuery";
import { projectsQuery } from "@/query/projectsQuery";

type ProjectSpotlightProps = {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onSignOut: () => void;
};

/** The spotlight (mod+k / mod+space) of every project page: the canvas one, minus the canvas. */
export function ProjectSpotlight({ isOpen, onOpenChange, onSignOut }: ProjectSpotlightProps) {
	const navigate = useNavigate();
	const { projectId } = useParams({ strict: false }) as { projectId?: string };
	const { data: projects } = projectsQuery.getAll.useQuery({ page: 1, perPage: 50 });
	const [query, setQuery] = useState("");
	// fetched on the first search, not on every page load; kept in cache after that
	const { data: integrations } = integrationsQuery.getBasicList.useQuery(
		projectId ?? "",
		undefined,
		isOpen && query.trim() !== "",
	);
	const close = () => onOpenChange(false);
	const shared = useSpotlightCommands({ actions: [], onClose: close, inPlace: true });

	const extra: SpotlightCommand[] = [
		{
			id: "nav-all-projects",
			title: "Go to: All Projects",
			subtitle: "Navigation",
			category: "Navigation",
			keywords: ["goto", "nav", "home", "projects", "back"],
			icon: <TbHome size={15} />,
			onSelect: () => {
				close();
				navigate({ to: "/" });
			},
		},
		{
			id: "sign-out",
			title: "Sign out",
			subtitle: "Account",
			category: "Actions",
			keywords: ["sign out", "logout", "log out", "account"],
			icon: <TbLogout size={15} />,
			onSelect: () => {
				close();
				onSignOut();
			},
		},
	];
	for (const project of projects?.data ?? []) {
		if (project.id === projectId) continue;
		extra.push({
			id: `resource-project-${project.id}`,
			title: `Project: ${project.name}`,
			subtitle: "Switch project",
			description: project.description ?? undefined,
			category: "Resources",
			keywords: ["goto", "switch", "project", project.name],
			icon: <TbSwitchHorizontal size={15} />,
			onSelect: () => {
				close();
				navigate({ to: "/$projectId/routes", params: { projectId: project.id } });
			},
		});
	}
	for (const integration of integrations ?? []) {
		const groupName =
			humanReadableConnectorNames[integration.group as keyof typeof humanReadableConnectorNames] ??
			integration.group;
		extra.push({
			id: `resource-integration-${integration.id}`,
			title: `Integration: ${integration.name}`,
			subtitle: `${groupName} • ${integration.variant}`,
			category: "Resources",
			keywords: ["goto", "integration", integration.group, integration.variant, groupName],
			icon: integrationIcons[integration.variant] ?? <TbPlugConnected size={15} />,
			onSelect: () => {
				close();
				navigate({
					to: "/$projectId/integrations/$integrationId",
					params: { projectId: projectId ?? "", integrationId: integration.id },
				});
			},
		});
	}
	const commands = [...shared, ...extra];

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (matchCombo(e, "mod+k") || matchCombo(e, "mod+space")) {
				e.preventDefault();
				onOpenChange(!isOpen);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [isOpen, onOpenChange]);

	return (
		<CanvasSpotlight
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			commands={commands}
			onQueryChange={setQuery}
		/>
	);
}
