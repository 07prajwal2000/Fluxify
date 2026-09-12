import { useMemo, useState } from "react";
import { Button, CloseButton, Input, Label, TextField } from "@fluxify/components";
import { TbHistory, TbSearch } from "react-icons/tb";
import type { OrchestrationEvent } from "@/services/orchestration";
import { EventLog } from "./EventLog";

type FilterType = "all" | "failures" | "nodes" | "claims";

export function NodeHistoryView({
	events,
	isLoading,
	showProject = false,
}: {
	events: OrchestrationEvent[] | undefined;
	isLoading?: boolean;
	showProject?: boolean;
}) {
	const [filter, setFilter] = useState<FilterType>("all");
	const [search, setSearch] = useState("");

	const filteredEvents = useMemo(() => {
		if (!events) return [];
		return events.filter((event) => {
			if (filter === "failures") {
				const isFailure =
					event.action.endsWith("_failed") ||
					Boolean(event.reason && event.reason.toLowerCase().includes("fail"));
				if (!isFailure) return false;
			} else if (filter === "nodes") {
				const isNode = !event.action.startsWith("claim_");
				if (!isNode) return false;
			} else if (filter === "claims") {
				const isClaim = event.action.startsWith("claim_");
				if (!isClaim) return false;
			}

			if (search.trim()) {
				const query = search.toLowerCase();
				const matchAction = event.action.toLowerCase().includes(query);
				const matchNode = event.nodeId?.toLowerCase().includes(query);
				const matchReason = event.reason?.toLowerCase().includes(query);
				const matchProject =
					showProject && Boolean(event.projectId?.toLowerCase().includes(query));
				if (!matchAction && !matchNode && !matchReason && !matchProject) return false;
			}

			return true;
		});
	}, [events, filter, search, showProject]);

	const failureCount = useMemo(
		() =>
			events?.filter(
				(e) =>
					e.action.endsWith("_failed") ||
					Boolean(e.reason && e.reason.toLowerCase().includes("fail")),
			).length ?? 0,
		[events],
	);

	return (
		<div className="flex flex-col gap-4">
			<section className="overflow-hidden rounded-xl border border-border bg-background">
				<header className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<div className="flex items-center gap-2">
							<TbHistory className="text-muted" size={16} />
							<h3 className="text-sm font-bold text-foreground">Node History & Activity</h3>
							{events && events.length > 0 && (
								<span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs font-semibold text-muted">
									{events.length}
								</span>
							)}
						</div>
						<p className="mt-0.5 text-xs text-muted">
							What has happened to this project's nodes. A node that was removed is only visible here.
						</p>
					</div>

					<div className="flex items-center gap-2">
						<div className="relative w-full sm:w-56">
							<TextField
								value={search}
								onChange={setSearch}
								className="w-full"
								aria-label="Filter events by ID or keyword"
							>
								<Label className="sr-only">Search events</Label>
								<div className="relative flex items-center">
									<TbSearch
										size={14}
										className="pointer-events-none absolute left-2.5 text-muted"
									/>
									<Input
										placeholder="Filter by ID, action..."
										className="h-8 pl-8 pr-8 text-xs"
									/>
									{search && (
										<div className="absolute right-1">
											<CloseButton
												aria-label="Clear search"
												onPress={() => setSearch("")}
												className="h-6 w-6"
											/>
										</div>
									)}
								</div>
							</TextField>
						</div>
					</div>
				</header>

				{events && events.length > 0 && (
					<div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface px-4 py-2 text-xs">
						<span className="mr-1 text-muted">Filter:</span>
						<Button
							size="sm"
							variant={filter === "all" ? "primary" : "ghost"}
							className="h-6 px-2.5 text-xs"
							onPress={() => setFilter("all")}
						>
							All ({events.length})
						</Button>
						<Button
							size="sm"
							variant={filter === "failures" ? "primary" : "ghost"}
							className="h-6 px-2.5 text-xs"
							onPress={() => setFilter("failures")}
						>
							Failures {failureCount > 0 ? `(${failureCount})` : ""}
						</Button>
						<Button
							size="sm"
							variant={filter === "nodes" ? "primary" : "ghost"}
							className="h-6 px-2.5 text-xs"
							onPress={() => setFilter("nodes")}
						>
							Nodes
						</Button>
						<Button
							size="sm"
							variant={filter === "claims" ? "primary" : "ghost"}
							className="h-6 px-2.5 text-xs"
							onPress={() => setFilter("claims")}
						>
							Claims
						</Button>

						{(filter !== "all" || search) && (
							<Button
								size="sm"
								variant="ghost"
								className="ml-auto h-6 text-xs text-muted hover:text-foreground"
								onPress={() => {
									setFilter("all");
									setSearch("");
								}}
							>
								Clear filters
							</Button>
						)}
					</div>
				)}

				{events && events.length > 0 && filteredEvents.length === 0 ? (
					<div className="p-8 text-center">
						<p className="text-sm font-medium text-foreground">No matching events found</p>
						<p className="mt-1 text-xs text-muted">
							Try adjusting your filter criteria or search query.
						</p>
						<Button
							size="sm"
							variant="secondary"
							className="mt-3"
							onPress={() => {
								setFilter("all");
								setSearch("");
							}}
						>
							Reset filters
						</Button>
					</div>
				) : (
					<EventLog events={filteredEvents} isLoading={isLoading} showProject={showProject} />
				)}
			</section>
		</div>
	);
}
