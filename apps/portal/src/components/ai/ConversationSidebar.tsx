import { useEffect, useState } from "react";
import { TbAlertTriangle, TbChevronsLeft, TbPlus, TbRefresh, TbSearch } from "react-icons/tb";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Input, Spinner, Tabs, TextField } from "@fluxify/components";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { ConversationItem } from "./ConversationItem";
import { groupConversations } from "./group";
import type { HarnessConversation } from "./types";

type Tab = "all" | "pinned" | "archived";

type Props = {
	projectId: string;
	onToggle: () => void;
	onOpen: (id: string) => void;
	onNew: () => void;
	activeId?: string;
};

export function ConversationSidebar({ projectId, onToggle, onOpen, onNew, activeId }: Props) {
	const qc = useQueryClient();
	const [tab, setTab] = useState<Tab>("all");
	const [searchInput, setSearchInput] = useState("");
	const [search, setSearch] = useState("");

	// Debounce the server-side search so we don't fire a request per keystroke.
	useEffect(() => {
		const t = setTimeout(() => setSearch(searchInput.trim()), 300);
		return () => clearTimeout(t);
	}, [searchInput]);

	const query = harnessConversationsQuery.list.useInfiniteQuery(projectId, {
		perPage: 20,
		needUserQuery: true,
		archived: tab === "archived",
		pinned: tab === "pinned" ? true : undefined,
		search: search || undefined,
	});

	const items = (query.data?.pages.flatMap((p) => p.data) ?? []) as HarnessConversation[];
	const groups = groupConversations(items, { separatePinned: tab !== "archived" });

	return (
		<aside className="flex h-full w-80 max-w-[85vw] flex-col gap-3 border-r border-border pr-3">
			<div className="flex items-center justify-between pt-1">
				<span className="text-base font-semibold text-foreground">Conversations</span>
				<div className="flex items-center gap-0.5">
					{/* Hidden until the first load settles; icon spins only on manual refresh. */}
					{query.isSuccess && (
						<Button
							isIconOnly
							size="sm"
							variant="ghost"
							aria-label="Refresh"
							onPress={() => qc.invalidateQueries({ queryKey: ["harness-conversations", projectId] })}
						>
							<TbRefresh size={17} className={query.isRefetching ? "animate-spin" : ""} />
						</Button>
					)}
					<Button isIconOnly size="sm" variant="ghost" aria-label="Collapse" onPress={onToggle}>
						<TbChevronsLeft size={18} />
					</Button>
				</div>
			</div>

			<TextField
				aria-label="Search conversations"
				className="w-full"
				value={searchInput}
				onChange={setSearchInput}
			>
				<div className="relative w-full">
					<TbSearch
						size={16}
						className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
					/>
					<Input placeholder="Search conversations…" className="w-full pl-9" />
				</div>
			</TextField>

			<Button variant="primary" className="w-full" onPress={onNew}>
				<TbPlus size={18} /> New Chat
			</Button>

			<Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as Tab)}>
				<Tabs.ListContainer>
					<Tabs.List aria-label="Conversation filter" className="w-full">
						<Tabs.Tab id="all">
							All
							<Tabs.Indicator />
						</Tabs.Tab>
						<Tabs.Tab id="pinned">
							Pinned
							<Tabs.Indicator />
						</Tabs.Tab>
						<Tabs.Tab id="archived">
							Archived
							<Tabs.Indicator />
						</Tabs.Tab>
					</Tabs.List>
				</Tabs.ListContainer>
			</Tabs>

			<div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-1">
				{query.isLoading ? (
					<div className="flex justify-center py-8">
						<Spinner size="sm" />
					</div>
				) : query.isError ? (
					<div className="flex flex-col items-center gap-3 px-2 py-10 text-center">
						<TbAlertTriangle size={22} className="text-danger" />
						<p className="text-xs text-muted">Couldn't load conversations.</p>
						<Button size="sm" variant="secondary" onPress={() => query.refetch()}>
							<TbRefresh size={15} /> Reload
						</Button>
					</div>
				) : items.length === 0 ? (
					<p className="px-2 py-8 text-center text-xs text-muted">
						{search ? "No matches." : "No conversations yet."}
					</p>
				) : (
					<div className="flex flex-col gap-4">
						{groups.map((g) => (
							<section key={g.key} className="flex flex-col gap-1">
								<div className="flex items-center gap-2 px-1 pb-0.5">
									<span className="text-[11px] font-medium tracking-[0.12em] text-muted uppercase">
										{g.label}
									</span>
									<span className="text-[11px] text-muted">{g.items.length}</span>
									<span className="h-px flex-1 bg-border" />
								</div>
								{g.items.map((c) => (
									<ConversationItem
										key={c.id}
										projectId={projectId}
										conversation={c}
										active={activeId === c.id}
										onOpen={onOpen}
									/>
								))}
							</section>
						))}

						{query.hasNextPage && (
							<Button
								variant="ghost"
								size="sm"
								className="mx-auto"
								isPending={query.isFetchingNextPage}
								onPress={() => query.fetchNextPage()}
							>
								Load more
							</Button>
						)}
					</div>
				)}
			</div>
		</aside>
	);
}
