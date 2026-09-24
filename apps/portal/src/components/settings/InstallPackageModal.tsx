import { CloseButton, cn, Input, Modal, Spinner } from "@fluxify/components";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { TbPackage, TbSearch, TbX } from "react-icons/tb";
import { type NpmSearchHit, searchNpm } from "@/lib/npmRegistry";
import { PackageDetailsPanel } from "./PackageDetailsPanel";

export function InstallPackageModal({
	projectId,
	minReleaseAgeDays,
	isOpen,
	onOpenChange,
}: {
	projectId: string;
	minReleaseAgeDays: number;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [text, setText] = useState("");
	const [query, setQuery] = useState("");
	const [picked, setPicked] = useState<NpmSearchHit | null>(null);

	useEffect(() => {
		const t = setTimeout(() => setQuery(text.trim()), 300);
		return () => clearTimeout(t);
	}, [text]);

	useEffect(() => {
		if (isOpen) {
			setText("");
			setQuery("");
			setPicked(null);
		}
	}, [isOpen]);

	const search = useQuery({
		queryKey: ["npm-search", query],
		queryFn: ({ signal }) => searchNpm(query, signal),
		enabled: query.length > 1,
		staleTime: 60_000,
	});

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog
						className={cn("w-full transition-[max-width]", picked ? "!max-w-5xl" : "!max-w-2xl")}
					>
						<Modal.Header className="flex flex-col gap-3 px-6 pb-2 pt-5">
							<div className="flex items-start justify-between gap-3">
								<div className="flex min-w-0 flex-1 items-center gap-3">
									<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
										<TbPackage size={20} />
									</span>
									<div className="min-w-0 flex-1">
										<Modal.Heading className="text-base font-semibold text-foreground">
											Install npm package
										</Modal.Heading>
										<p className="mt-0.5 text-xs text-muted">
											Search the npm registry and pick a package to add to this project.
										</p>
									</div>
								</div>
								<CloseButton />
							</div>
							<div className="relative pt-1">
								<TbSearch
									className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
									size={15}
								/>
								<Input
									autoFocus
									placeholder="Search npm packages…"
									value={text}
									onChange={(e) => setText(e.currentTarget.value)}
									className="h-8 w-full pl-8 pr-7 text-xs"
								/>
								{text && (
									<button
										type="button"
										aria-label="Clear search"
										onClick={() => setText("")}
										className="absolute right-2 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-foreground"
									>
										<TbX size={13} />
									</button>
								)}
							</div>
						</Modal.Header>

						<Modal.Body className="flex h-[480px] gap-5 px-6 pb-5 pt-2">
							<div className="min-w-0 flex-1 overflow-y-auto">
								<ResultsTable
									hits={search.data}
									isLoading={search.isFetching}
									query={query}
									picked={picked?.name}
									onPick={setPicked}
								/>
							</div>
							{picked && (
								<PackageDetailsPanel
									key={picked.name}
									projectId={projectId}
									hit={picked}
									minReleaseAgeDays={minReleaseAgeDays}
									onClose={() => setPicked(null)}
									onInstalled={() => onOpenChange(false)}
								/>
							)}
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

function ResultsTable({
	hits,
	isLoading,
	query,
	picked,
	onPick,
}: {
	hits?: NpmSearchHit[];
	isLoading: boolean;
	query: string;
	picked?: string;
	onPick: (hit: NpmSearchHit) => void;
}) {
	if (isLoading && !hits) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}
	if (!hits?.length) {
		return (
			<div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center text-xs text-muted">
				<TbSearch size={26} className="mb-2 text-muted/60" />
				{query.length > 1 ? `No packages matching “${query}”` : "Type to search npm"}
			</div>
		);
	}
	return (
		<table className="w-full text-left text-xs">
			<thead className="sticky top-0 bg-overlay text-muted">
				<tr className="border-b border-border">
					<th className="px-3 py-2 font-medium">Name</th>
					<th className="w-28 px-3 py-2 font-medium">Version</th>
				</tr>
			</thead>
			<tbody>
				{hits.map((hit) => (
					<tr
						key={hit.name}
						onClick={() => onPick(hit)}
						className={cn(
							"cursor-pointer border-b border-border transition-colors",
							picked === hit.name ? "bg-accent/10" : "hover:bg-surface-secondary",
						)}
					>
						<td className="max-w-0 px-3 py-2">
							<div className="truncate font-mono font-semibold text-foreground">{hit.name}</div>
							{hit.description && <div className="truncate text-muted">{hit.description}</div>}
						</td>
						<td className="px-3 py-2 font-mono text-muted">{hit.version}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
