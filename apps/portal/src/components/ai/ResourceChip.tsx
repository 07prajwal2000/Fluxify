import React, { useState } from "react";
import {
	TbStack2,
	TbCloudCog,
	TbSquareKey,
	TbBox,
	TbDatabase,
	TbExternalLink,
	TbPlus,
} from "react-icons/tb";
import {
	Popover,
	PopoverTrigger,
	PopoverContent,
	Button,
	Spinner,
} from "@fluxify/components";
import { useParams, Link } from "@tanstack/react-router";
import { integrationIcons } from "@fluxify/components";
import { appConfigQuery } from "@/query/appConfigQuery";
import { integrationsQuery } from "@/query/integrationsQuery";
import { CreateConfigButton } from "@/components/appConfig/CreateConfigModal";
import { IntegrationOnboardingModal } from "@/components/integrations/IntegrationOnboardingModal";

export interface ResourceChipProps {
	type: "route" | "app_config" | "integration" | "custom_block";
	identifier: string;
	name?: string;
	data?: string;
}

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
	route: TbStack2,
	app_config: TbSquareKey,
	integration: TbCloudCog,
	custom_block: TbBox,
};

/**
 * Whether the app config / integration a plan mentions actually exists yet.
 *
 * The planner is told to warn about a missing dependency rather than refuse the
 * request, so a chip can name something that was never created — sending the
 * user to a page that does not list it. Looking it up here is what lets the
 * chip offer "Create" instead of a dead link. Route and custom block chips are
 * only ever emitted for real records, so they skip the lookup.
 */
function useResourceLookup(
	type: ResourceChipProps["type"],
	projectId: string,
	identifier: string,
	name: string,
) {
	const configs = appConfigQuery.getAll.useQuery(
		projectId,
		{ page: 1, perPage: 20, search: name },
		{ enabled: type === "app_config" && Boolean(projectId && name) },
	);
	// Shared across every integration chip in the conversation: one project-wide
	// list, cached, rather than a request per chip.
	const integrations = integrationsQuery.getBasicList.useQuery(
		type === "integration" ? projectId : "",
	);

	if (type === "app_config") {
		if (!name) return { status: "unknown" as const };
		if (configs.isLoading) return { status: "loading" as const };
		const match = (configs.data?.data ?? []).find(
			(row: { id: number; keyName: string }) =>
				row.keyName?.toLowerCase() === name.toLowerCase() ||
				String(row.id) === identifier,
		);
		return match
			? { status: "found" as const, match }
			: { status: "missing" as const };
	}

	if (type === "integration") {
		if (integrations.isLoading) return { status: "loading" as const };
		const match = (integrations.data ?? []).find(
			(row) => row.id === identifier || row.name?.toLowerCase() === name.toLowerCase(),
		);
		return match
			? { status: "found" as const, match }
			: { status: "missing" as const };
	}

	return { status: "unknown" as const };
}

export function ResourceChip({ type, identifier, name, data }: ResourceChipProps) {
	const FallbackIcon = ICONS[type] || TbDatabase;
	const [isOpen, setIsOpen] = useState(false);
	const [creating, setCreating] = useState(false);

	// Parse the API results from data
	let parsedData: any = {};
	if (data) {
		try {
			parsedData = JSON.parse(decodeURIComponent(data));
		} catch (e) {
			console.error("Failed to parse resource data", e);
		}
	}

	let CustomIconNode = null;
	if (type === "integration" && parsedData?.variant && integrationIcons[parsedData.variant]) {
		CustomIconNode = integrationIcons[parsedData.variant];
	}

	// Get projectId from router params (or fallback to window location)
	let projectId = "";
	try {
		const params = useParams({ strict: false }) as any;
		projectId = params.projectId;
	} catch (e) {
		projectId = window.location.pathname.split("/")[2];
	}

	const label = parsedData?.name || name || "";
	const lookup = useResourceLookup(type, projectId, identifier, label);

	// Build the URL based on the resource type. For the two that are looked up,
	// the live record supplies the ids the page actually navigates by — the
	// planner's own identifier can be stale or invented.
	let targetUrl = "";
	if (projectId) {
		if (type === "route") {
			targetUrl = `/${projectId}/canvas/${identifier}`;
		} else if (type === "integration" && lookup.status === "found") {
			const found = lookup.match as { id: string; group: string };
			targetUrl = `/${projectId}/integrations?group=${encodeURIComponent(found.group)}&open=${found.id}`;
		} else if (type === "app_config" && lookup.status === "found") {
			const found = lookup.match as { keyName: string };
			targetUrl = `/${projectId}/app-config?q=${encodeURIComponent(found.keyName)}`;
		} else if (type === "custom_block") {
			targetUrl = `/${projectId}/custom-block-canvas/${identifier}`;
		}
	}

	const canCreate = lookup.status === "missing" && Boolean(projectId);

	return (
		<>
			<Popover isOpen={isOpen} onOpenChange={setIsOpen}>
				<PopoverTrigger>
					{/* A resource that does not exist yet is drawn dashed, the way the
					    old "Create …" button was, so the difference is visible without
					    opening the chip. */}
					<span
						className={`inline-flex items-center gap-1 align-baseline mx-0.5 px-2 py-0.5 rounded-md text-xs font-medium bg-[var(--accent)]/10 text-[var(--accent)] border select-none cursor-pointer hover:bg-[var(--accent)]/20 transition-colors ${
							lookup.status === "missing"
								? "border-dashed border-[var(--accent)]/40"
								: "border-[var(--accent)]/20"
						}`}
					>
						{CustomIconNode ? (
							<span className="shrink-0 [&>svg]:w-[13px] [&>svg]:h-[13px] inline-flex items-center">
								{CustomIconNode}
							</span>
						) : (
							<FallbackIcon size={13} className="shrink-0" />
						)}
						<span>{name || type.replace("_", " ")}</span>
					</span>
				</PopoverTrigger>
				<PopoverContent className="w-64 rounded-xl border border-border bg-overlay p-3 shadow-xl">
					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-2">
							<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
								{CustomIconNode ? (
									<span className="[&>svg]:w-4 [&>svg]:h-4 inline-flex items-center">
										{CustomIconNode}
									</span>
								) : (
									<FallbackIcon size={16} />
								)}
							</div>
							<div className="flex flex-col">
								<span className="text-sm font-medium text-foreground">{name || type.replace("_", " ")}</span>
								<span className="text-[10px] uppercase tracking-wider text-muted">{type.replace("_", " ")}</span>
							</div>
						</div>
						{parsedData?.description && (
							<p className="text-xs text-muted line-clamp-2 mt-1">
								{parsedData.description}
							</p>
						)}
						{lookup.status === "missing" && (
							<p className="mt-1 text-xs text-muted">
								This {type === "app_config" ? "config key" : "integration"} doesn't
								exist in the project yet.
							</p>
						)}

						{lookup.status === "loading" ? (
							<div className="mt-2 flex justify-end border-t border-border pt-2">
								<Spinner size="sm" />
							</div>
						) : (canCreate || targetUrl) ? (
							<div className="mt-2 flex justify-end gap-2 border-t border-border pt-2">
								<Button
									size="sm"
									variant="ghost"
									className="h-7 text-xs px-2"
									onPress={() => setIsOpen(false)}
								>
									Cancel
								</Button>
								{canCreate ? (
									<Button
										size="sm"
										variant="primary"
										className="h-7 text-xs px-3 font-medium flex items-center gap-1"
										onPress={() => {
											setIsOpen(false);
											setCreating(true);
										}}
									>
										<span>Create</span>
										<TbPlus size={12} />
									</Button>
								) : (
									<Link to={targetUrl} target="_blank">
										<Button
											size="sm"
											variant="primary"
											className="h-7 text-xs px-3 font-medium flex items-center gap-1"
											onPress={() => setIsOpen(false)}
										>
											<span>Go to</span>
											<TbExternalLink size={12} />
										</Button>
									</Link>
								)}
							</div>
						) : null}
					</div>
				</PopoverContent>
			</Popover>

			{/* Created from here rather than on the settings page, so the user never
			    loses the conversation they are reading. */}
			{type === "app_config" && creating && (
				<CreateConfigButton
					projectId={projectId}
					isOpen={creating}
					onOpenChange={setCreating}
					initialKeyName={label}
				/>
			)}
			{type === "integration" && creating && (
				<IntegrationOnboardingModal
					projectId={projectId}
					isOpen={creating}
					onOpenChange={setCreating}
				/>
			)}
		</>
	);
}
