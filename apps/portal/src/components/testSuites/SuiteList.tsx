import { Button, Chip, cn, Dropdown, Label, Spinner } from "@fluxify/components";
import { useState } from "react";
import { TbCopy, TbDotsVertical, TbPlus, TbSearch, TbTrash } from "react-icons/tb";
import type { SuiteTarget } from "@/services/testSuites";

export function SuiteList({
	kind,
	suites,
	isLoading,
	selectedId,
	onSelect,
	onCreate,
	onClone,
	onDelete,
	isCreating,
}: {
	kind: SuiteTarget["type"];
	suites: { id: string; name: string; enabled: boolean }[];
	isLoading: boolean;
	selectedId: string | null;
	onSelect: (id: string) => void;
	onCreate: () => void;
	onClone: (suite: { id: string; name: string }) => void;
	onDelete: (suite: { id: string; name: string }) => void;
	isCreating: boolean;
}) {
	const [filter, setFilter] = useState("");
	const shown = suites.filter((suite) => suite.name.toLowerCase().includes(filter.toLowerCase()));

	return (
		<aside className="flex w-72 shrink-0 flex-col border-r border-border">
			<div className="flex items-center gap-2 border-b border-border px-3 py-2">
				<div className="flex flex-1 items-center gap-2 rounded-md border border-border bg-background-secondary px-2 py-1.5">
					<TbSearch size={15} className="text-muted" />
					<input
						className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted"
						placeholder="Filter suites"
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
					/>
				</div>
				<Button
					variant="ghost"
					size="sm"
					aria-label="New suite"
					isPending={isCreating}
					onPress={onCreate}
				>
					<TbPlus size={16} />
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{isLoading ? (
					<div className="flex justify-center p-6">
						<Spinner size="sm" />
					</div>
				) : shown.length === 0 ? (
					<p className="p-6 text-center text-xs text-muted">
						{suites.length === 0 ? `No suites for this ${kind} yet.` : "Nothing matches."}
					</p>
				) : (
					shown.map((suite) => (
						<div
							key={suite.id}
							role="button"
							tabIndex={0}
							onClick={() => onSelect(suite.id)}
							onKeyDown={(e) => e.key === "Enter" && onSelect(suite.id)}
							className={cn(
								"group flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs transition-colors",
								suite.id === selectedId
									? "bg-accent/10 text-accent"
									: "text-muted hover:bg-surface-secondary hover:text-foreground",
							)}
						>
							<span className="min-w-0 flex-1 truncate">{suite.name || "Untitled suite"}</span>
							{!suite.enabled && (
								<Chip size="sm" color="warning">
									disabled
								</Chip>
							)}
							<Dropdown>
								<Dropdown.Trigger>
									<Button
										isIconOnly
										size="sm"
										variant="ghost"
										aria-label={`${suite.name} options`}
										className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
									>
										<TbDotsVertical size={16} />
									</Button>
								</Dropdown.Trigger>
								<Dropdown.Popover>
									<Dropdown.Menu
										onAction={(key) => (key === "clone" ? onClone(suite) : onDelete(suite))}
									>
										<Dropdown.Item id="clone" textValue="Clone">
											<TbCopy size={16} />
											<Label>Clone</Label>
										</Dropdown.Item>
										<Dropdown.Item
											id="delete"
											variant="danger"
											textValue="Delete"
											className="text-danger hover:bg-danger/10 focus:bg-danger/10 focus:text-danger"
										>
											<TbTrash size={16} className="text-danger" />
											<Label className="text-danger">Delete</Label>
										</Dropdown.Item>
									</Dropdown.Menu>
								</Dropdown.Popover>
							</Dropdown>
						</div>
					))
				)}
			</div>
		</aside>
	);
}
