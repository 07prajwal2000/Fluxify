import { Input, Spinner } from "@fluxify/components";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { VscMcp } from "react-icons/vsc";
import { integrationsQuery } from "@/query/integrationsQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import type { Mention } from "@/query/resourceSearchQuery";

type Props = {
	projectId: string;
	/** Opened by typing @: the @ is replaced by the chip. */
	wasAtTyped: boolean;
	onClose: () => void;
};

/** The @ picker: suggests only the allowed MCP servers configured in AI settings. */
export const MentionPopover = forwardRef<HTMLDivElement, Props>(function MentionPopover(
	{ projectId, wasAtTyped, onClose },
	ref,
) {
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);

	const { data: settingsData, isLoading: isSettingsLoading } =
		projectSettingsKeysQuery.getAll.useQuery(projectId);
	const { data: mcpIntegrations = [], isLoading: isIntegrationsLoading } =
		integrationsQuery.getAll.useQuery(projectId, "mcp");

	const allowedIds = useMemo(() => {
		const raw = (settingsData?.["settings.ai.agentMcpIntegrations"] as string | undefined) ?? "";
		return raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}, [settingsData]);

	const allowedServers = useMemo(() => {
		return mcpIntegrations.filter((server) => allowedIds.includes(server.id));
	}, [mcpIntegrations, allowedIds]);

	const filteredServers = useMemo(() => {
		const q = searchQuery.toLowerCase().trim();
		if (!q) return allowedServers;
		return allowedServers.filter((s) => s.name.toLowerCase().includes(q));
	}, [allowedServers, searchQuery]);

	const isLoading = isSettingsLoading || isIntegrationsLoading;
	const list = useRef<HTMLDivElement>(null);

	// the arrow keys move past the visible rows: bring the highlighted one into view
	useEffect(() => {
		list.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" });
	}, [selectedIndex]);

	useEffect(() => setSelectedIndex(0), [filteredServers.length, searchQuery]);

	const pick = (server: { id: string; name: string }) => {
		const res: Mention = {
			type: "integration",
			id: server.id,
			name: server.name,
			label: `@${server.name}`,
		};
		document.dispatchEvent(new CustomEvent("insert-resource", { detail: { res, wasAtTyped } }));
		onClose();
	};

	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Escape") {
			e.preventDefault();
			onClose();
			document.dispatchEvent(new CustomEvent("focus-editor"));
		} else if (!filteredServers.length) {
			return;
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex((i) => Math.min(i + 1, filteredServers.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (filteredServers[selectedIndex]) pick(filteredServers[selectedIndex]);
		}
	};

	const hint = isLoading
		? "Loading servers..."
		: allowedServers.length === 0
			? "No MCP servers configured in AI settings"
			: "No matching servers found";

	return (
		<div
			ref={ref}
			className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-full rounded-xl border border-border bg-overlay p-2 shadow-xl"
		>
			<div className="flex items-center gap-3">
				<Input
					value={searchQuery}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
					onKeyDown={onKeyDown}
					placeholder="Search servers..."
					autoFocus
					className="h-9 min-h-9 w-64 rounded-lg border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted hover:bg-surface-secondary focus-within:ring-1 focus-within:ring-focus"
				/>
				{isLoading && <Spinner size="sm" color="current" />}
			</div>
			<div ref={list} className="mt-2 h-[150px] w-full overflow-y-auto">
				{filteredServers.length > 0 ? (
					<div className="flex flex-col gap-1">
						{filteredServers.map((server, i) => (
							<button
								type="button"
								key={server.id}
								onClick={() => pick(server)}
								aria-current={i === selectedIndex}
								className={`flex items-center gap-3 rounded-lg p-2 text-left transition-colors ${
									i === selectedIndex
										? "bg-accent/15 text-foreground ring-1 ring-inset ring-accent/50"
										: "hover:bg-surface-secondary"
								}`}
							>
								<div className={`shrink-0 ${i === selectedIndex ? "text-accent" : "text-muted"}`}>
									<VscMcp size={16} />
								</div>
								<div className="flex min-w-0 flex-col">
									<span className="truncate text-sm font-medium text-foreground">
										@{server.name}
										<span className="ml-2 text-[10px] uppercase tracking-wider text-muted">
											MCP
										</span>
									</span>
									{server.config && typeof server.config === "object" && "url" in server.config && (
										<span className="line-clamp-1 font-mono text-xs text-muted">
											{String(server.config.url)}
										</span>
									)}
								</div>
							</button>
						))}
					</div>
				) : (
					<div className="flex h-full items-center justify-center p-3 text-center text-xs text-muted">
						{hint}
					</div>
				)}
			</div>
		</div>
	);
});
