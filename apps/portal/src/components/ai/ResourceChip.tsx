import React, { useState } from "react";
import {
	TbStack2,
	TbCloudCog,
	TbSquareKey,
	TbBox,
	TbDatabase,
    TbExternalLink,
} from "react-icons/tb";
import { Popover, PopoverTrigger, PopoverContent, Button } from "@fluxify/components";
import { useParams, Link } from "@tanstack/react-router";
import { integrationIcons } from "@fluxify/components";

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

export function ResourceChip({ type, identifier, name, data }: ResourceChipProps) {
	const FallbackIcon = ICONS[type] || TbDatabase;
    const [isOpen, setIsOpen] = useState(false);
    
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
        projectId = window.location.pathname.split('/')[2];
    }

    // Build the URL based on the resource type
    let targetUrl = "";
    if (projectId) {
        if (type === "route") {
            targetUrl = `/${projectId}/editor/${identifier}`;
        } else if (type === "integration") {
            targetUrl = `/${projectId}/integrations?group=ai&open=${identifier}`;
        } else if (type === "app_config") {
            // Usually the name is needed for the query
            const q = parsedData?.name || name || identifier;
            targetUrl = `/${projectId}/app-config?q=${encodeURIComponent(q)}`;
        } else if (type === "custom_block") {
            targetUrl = `/${projectId}/custom-blocks`;
        }
    }

	return (
        <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger>
                <span className="inline-flex items-center gap-1 align-baseline mx-0.5 px-2 py-0.5 rounded-md text-xs font-medium bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 select-none cursor-pointer hover:bg-[var(--accent)]/20 transition-colors">
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
                    {targetUrl && (
                        <div className="mt-2 flex justify-end gap-2 border-t border-border pt-2">
                            <Button 
                                size="sm" 
                                variant="ghost" 
                                className="h-7 text-xs px-2"
                                onPress={() => setIsOpen(false)}
                            >
                                Cancel
                            </Button>
                            <Link to={targetUrl} target="_blank">
                                <Button 
                                    size="sm" 
                                    variant="primary"
                                    className="h-7 text-xs px-3 font-medium flex items-center gap-1"
                                    onPress={() => setIsOpen(false)}
                                >
                                    <span>Open Resource</span>
                                    <TbExternalLink size={12} />
                                </Button>
                            </Link>
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
	);
}
