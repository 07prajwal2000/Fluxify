import { useMemo, useState } from "react";
import {
	Button,
	Chip,
	CloseButton,
	Drawer,
	Input,
	Skeleton,
	TextField,
} from "@fluxify/components";
import {
	TbBolt,
	TbPlus,
	TbSearch,
	TbServer,
	TbStack2,
	TbX,
} from "react-icons/tb";
import { triggersQuery } from "@/query/triggersQuery";
import type { TriggerGroup } from "@/services/triggers";
import { CreateTriggerGroupForm } from "./CreateTriggerGroupForm";
import { TriggerGroupRow } from "./TriggerGroupRow";
import { DeleteGroupDialog } from "./DeleteGroupDialog";

export type TriggerGroupsModalProps = {
	projectId: string;
	isOpen: boolean;
	onClose: () => void;
};

/**
 * Slide-over drawer for creating, renaming, and deleting a project's trigger groups.
 * Triggers in a group execute on dedicated workers to isolate execution pools.
 */
export function TriggerGroupsModal({
	projectId,
	isOpen,
	onClose,
}: TriggerGroupsModalProps) {
	const { data: groups = [], isLoading } = triggersQuery.groups.useQuery(projectId);

	const [isCreating, setIsCreating] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [pendingDelete, setPendingDelete] = useState<TriggerGroup | null>(null);

	const totalTriggers = useMemo(
		() => groups.reduce((sum, g) => sum + (g.triggerCount ?? 0), 0),
		[groups],
	);

	const filteredGroups = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return groups;
		return groups.filter(
			(g) =>
				g.name.toLowerCase().includes(query) ||
				(g.description && g.description.toLowerCase().includes(query)),
		);
	}, [groups, searchQuery]);

	const handleDrawerClose = () => {
		setIsCreating(false);
		setSearchQuery("");
		onClose();
	};

	return (
		<>
			<Drawer.Backdrop
				isOpen={isOpen}
				onOpenChange={(open) => !open && handleDrawerClose()}
				variant="blur"
				className="z-50"
			>
				<Drawer.Content placement="right" className="z-50">
					<Drawer.Dialog
						aria-label="Trigger groups"
						className="flex h-full w-full sm:max-w-lg md:max-w-xl flex-col bg-surface border-l border-border shadow-2xl p-0 overflow-hidden"
					>
						{/* Drawer Header */}
						<Drawer.Header className="flex flex-col gap-3 border-b border-border bg-surface px-6 py-5 shrink-0">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-3">
									<div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20">
										<TbStack2 size={20} />
									</div>
									<div className="flex items-center gap-2">
										<Drawer.Heading className="text-base font-semibold tracking-tight text-foreground">
											Trigger groups
										</Drawer.Heading>
										{!isLoading && (
											<Chip size="sm" variant="secondary" className="font-mono text-xs font-medium">
												{groups.length}
											</Chip>
										)}
									</div>
								</div>
								<CloseButton onPress={handleDrawerClose} aria-label="Close trigger groups drawer" />
							</div>

							<p className="text-xs text-muted leading-relaxed">
								Triggers assigned to a group execute on dedicated workers. Grouping isolates workloads so
								high-volume queues do not starve latency-sensitive triggers.
							</p>

							{/* Summary Stats Strip */}
							{!isLoading && groups.length > 0 && (
								<div className="flex items-center gap-4 rounded-lg border border-border/70 bg-surface-secondary/50 px-3.5 py-2 text-xs text-muted">
									<div className="flex items-center gap-1.5 font-medium text-foreground">
										<TbServer size={14} className="text-accent" />
										<span>{groups.length} worker {groups.length === 1 ? "group" : "groups"}</span>
									</div>
									<div className="h-3 w-px bg-border" />
									<div className="flex items-center gap-1.5">
										<TbBolt size={14} className="text-accent" />
										<span>{totalTriggers} total {totalTriggers === 1 ? "trigger" : "triggers"}</span>
									</div>
								</div>
							)}
						</Drawer.Header>

						{/* Drawer Body */}
						<Drawer.Body className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5 bg-surface">
							{/* New Group Section */}
							{isCreating ? (
								<CreateTriggerGroupForm
									projectId={projectId}
									onSuccess={() => setIsCreating(false)}
									onCancel={() => setIsCreating(false)}
								/>
							) : (
								<button
									type="button"
									onClick={() => setIsCreating(true)}
									className="group flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 px-4 text-xs font-medium text-muted transition-all hover:border-accent hover:text-accent hover:bg-accent/5 focus:outline-none focus:ring-2 focus:ring-accent/30"
								>
									<TbPlus size={16} className="transition-transform group-hover:scale-110" />
									<span>New trigger group</span>
								</button>
							)}

							{/* Search Filter Bar */}
							{groups.length > 2 && (
								<div className="relative">
									<TextField
										value={searchQuery}
										onChange={setSearchQuery}
										aria-label="Filter groups"
										className="w-full"
									>
										<div className="relative flex items-center">
											<TbSearch
												size={15}
												className="pointer-events-none absolute left-3 text-muted"
											/>
											<Input
												placeholder="Search groups..."
												className="pl-9 pr-8 py-1.5 text-xs bg-surface-secondary/40"
											/>
											{searchQuery && (
												<button
													type="button"
													onClick={() => setSearchQuery("")}
													className="absolute right-2.5 text-muted hover:text-foreground"
													aria-label="Clear search"
												>
													<TbX size={14} />
												</button>
											)}
										</div>
									</TextField>
								</div>
							)}

							{/* Groups List */}
							<div className="flex flex-col gap-2.5">
								{isLoading ? (
									<div className="flex flex-col gap-3">
										<Skeleton className="h-20 w-full rounded-xl" />
										<Skeleton className="h-20 w-full rounded-xl" />
									</div>
								) : filteredGroups.length === 0 ? (
									<div className="flex flex-col items-center justify-center rounded-xl border border-border/80 bg-surface-secondary/30 p-8 text-center">
										{searchQuery ? (
											<>
												<TbSearch size={24} className="text-muted mb-2 opacity-60" />
												<p className="text-sm font-medium text-foreground">No matching groups found</p>
												<p className="text-xs text-muted mt-1">
													No groups match “{searchQuery}”.
												</p>
												<Button
													size="sm"
													variant="ghost"
													className="mt-3"
													onPress={() => setSearchQuery("")}
												>
													Clear search
												</Button>
											</>
										) : (
											<>
												<TbStack2 size={24} className="text-muted mb-2 opacity-60" />
												<p className="text-sm font-medium text-foreground">No trigger groups yet</p>
												<p className="text-xs text-muted mt-1 max-w-xs">
													Create groups to segment your triggers and allocate isolated worker pools.
												</p>
												<Button
													size="sm"
													variant="primary"
													className="mt-3"
													onPress={() => setIsCreating(true)}
												>
													<TbPlus size={15} /> Create your first group
												</Button>
											</>
										)}
									</div>
								) : (
									filteredGroups.map((group) => (
										<TriggerGroupRow
											key={group.id}
											projectId={projectId}
											group={group}
											onDelete={() => setPendingDelete(group)}
										/>
									))
								)}
							</div>
						</Drawer.Body>

						{/* Drawer Footer */}
						<Drawer.Footer className="flex items-center justify-between border-t border-border bg-surface-secondary/40 px-6 py-3 shrink-0">
							<span className="text-[11px] text-muted">
								Changes apply immediately to active triggers.
							</span>
							<Button size="sm" variant="secondary" onPress={handleDrawerClose}>
								Done
							</Button>
						</Drawer.Footer>
					</Drawer.Dialog>
				</Drawer.Content>
			</Drawer.Backdrop>

			{/* Deletion Dialog */}
			<DeleteGroupDialog
				projectId={projectId}
				group={pendingDelete}
				groups={groups}
				onClose={() => setPendingDelete(null)}
			/>
		</>
	);
}
