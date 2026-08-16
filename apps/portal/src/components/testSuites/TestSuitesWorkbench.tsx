import { useEffect, useMemo, useState } from "react";
import { Button, DeleteIconButton, Spinner, cn, toast } from "@fluxify/components";
import { TbPlayerPlay, TbPlus, TbSearch } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { RouteSwitcher } from "@/components/routes/RouteSwitcher";
import {
	RouteWorkbenchHeader,
	RouteWorkbenchTabs,
} from "@/components/routes/RouteWorkbenchTabs";
import { showErrorNotification } from "@/lib/errorNotifier";
import { routesQuery } from "@/query/routesQuery";
import { testSuitesQuery } from "@/query/testSuitesQuery";
import { IN_FLIGHT_STATUSES } from "@/services/testSuites";
import { AssertionsEditor } from "./AssertionsEditor";
import { OverridesEditor } from "./OverridesEditor";
import { RequestEditor } from "./RequestEditor";
import { RunResults } from "./RunResults";
import { validateAssertions } from "./assertions";
import { toDraft, type SuiteDraft } from "./types";

const EDITOR_TABS = ["Request", "Assertions", "Overrides"] as const;

type EditorTab = (typeof EDITOR_TABS)[number];

function SuiteList({
	suites,
	isLoading,
	selectedId,
	onSelect,
	onCreate,
	onDelete,
	isCreating,
}: {
	suites: { id: string; name: string }[];
	isLoading: boolean;
	selectedId: string | null;
	onSelect: (id: string) => void;
	onCreate: () => void;
	onDelete: (suite: { id: string; name: string }) => void;
	isCreating: boolean;
}) {
	const [filter, setFilter] = useState("");
	const shown = suites.filter((suite) =>
		suite.name.toLowerCase().includes(filter.toLowerCase()),
	);

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
						{suites.length === 0 ? "No suites for this route yet." : "Nothing matches."}
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
							<DeleteIconButton
								aria-label={`Delete ${suite.name}`}
								size="sm"
								className="opacity-0 transition-opacity group-hover:opacity-100"
								onPress={() => onDelete(suite)}
							/>
						</div>
					))
				)}
			</div>
		</aside>
	);
}

export function TestSuitesWorkbench({
	projectId,
	routeId,
}: {
	projectId: string;
	routeId: string;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [tab, setTab] = useState<EditorTab>("Request");
	const [draft, setDraft] = useState<SuiteDraft>(() => toDraft(undefined));
	const [isDirty, setDirty] = useState(false);
	const [runId, setRunId] = useState<string | null>(null);
	const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

	const route = routesQuery.byId.useQuery(routeId);
	const suites = testSuitesQuery.getAll.useQuery(routeId);
	const detail = testSuitesQuery.getById.useQuery(routeId, selectedId);
	const create = testSuitesQuery.create.mutation(routeId);
	const update = testSuitesQuery.update.mutation(routeId, selectedId ?? "");
	const remove = testSuitesQuery.remove.mutation(routeId);
	const startRun = testSuitesQuery.startRun.mutation(projectId, routeId);
	// Same query key the results panel polls, so react-query serves both from one
	// request — this is only here to know when the run is still moving.
	const activeRun = testSuitesQuery.getRun.useQuery(projectId, routeId, runId);
	const isRunning =
		startRun.isPending ||
		(!!runId && (!activeRun.data || IN_FLIGHT_STATUSES.includes(activeRun.data.status)));

	const list = useMemo(
		() =>
			(suites.data ?? []).map((suite) => ({
				id: suite.id ?? "",
				name: suite.name ?? "",
			})),
		[suites.data],
	);

	const suiteNames = useMemo(
		() => Object.fromEntries(list.map((suite) => [suite.id, suite.name])),
		[list],
	);

	// Open the first suite once the list arrives, so the editor is never blank
	// when there is something to show.
	useEffect(() => {
		if (!selectedId && list.length > 0) setSelectedId(list[0].id);
	}, [list, selectedId]);

	// Seed the form from the loaded suite. Keyed on the suite id, not the query
	// data, so a background refetch cannot wipe unsaved edits.
	useEffect(() => {
		if (detail.data) {
			setDraft(toDraft(detail.data));
			setDirty(false);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- reseed per suite, not per refetch
	}, [selectedId, detail.data?.id]);

	const assertionErrors = validateAssertions(draft.assertions);
	const canSave = isDirty && assertionErrors.size === 0 && draft.name.trim().length > 0;

	function patch(next: Partial<SuiteDraft>) {
		setDraft((current) => ({ ...current, ...next }));
		setDirty(true);
	}

	async function onSave() {
		if (!selectedId || !canSave) return;
		try {
			await update.mutateAsync({
				name: draft.name,
				description: draft.description,
				routeId,
				projectId,
				headers: draft.headers,
				queryParams: draft.queryParams,
				routeParams: draft.routeParams,
				params: {},
				body: draft.body ?? null,
				assertions: draft.assertions,
				appConfigOverrides: draft.appConfigOverrides,
				integrationOverrides: draft.integrationOverrides,
			});
			setDirty(false);
			toast.success("Suite saved");
		} catch (error) {
			// The server also rejects an integration from another project — its
			// message is the useful one, so surface it rather than a generic failure.
			showErrorNotification(error as Error);
		}
	}

	async function onCreate() {
		try {
			const created = await create.mutateAsync({
				name: "New suite",
				description: "",
			});
			setSelectedId(created.id);
		} catch (error) {
			showErrorNotification(error as Error);
		}
	}

	async function onRun(suiteIds?: string[]) {
		try {
			const { runId: id } = await startRun.mutateAsync(suiteIds);
			setRunId(id);
		} catch (error) {
			showErrorNotification(error as Error);
		}
	}

	async function onConfirmDelete() {
		if (!pendingDelete) return;
		try {
			await remove.mutateAsync(pendingDelete.id);
			if (pendingDelete.id === selectedId) setSelectedId(null);
			setPendingDelete(null);
		} catch (error) {
			showErrorNotification(error as Error);
		}
	}

	return (
		<>
			<RouteWorkbenchHeader>
				<RouteSwitcher projectId={projectId} routeId={routeId} />
				<RouteWorkbenchTabs projectId={projectId} routeId={routeId} />
				<div className="ml-auto flex items-center gap-2">
					<span className="text-xs text-muted">
						{list.length} suite{list.length === 1 ? "" : "s"}
					</span>
					<Button
						variant="outline"
						isDisabled={list.length === 0 || isRunning}
						isPending={isRunning}
						onPress={() => void onRun()}
					>
						<TbPlayerPlay size={16} /> {isRunning ? "Running…" : "Run all"}
					</Button>
					<Button variant="primary" isPending={create.isPending} onPress={() => void onCreate()}>
						<TbPlus size={16} /> New suite
					</Button>
				</div>
			</RouteWorkbenchHeader>

			<div className="flex min-h-0 flex-1">
				<SuiteList
					suites={list}
					isLoading={suites.isLoading}
					selectedId={selectedId}
					isCreating={create.isPending}
					onSelect={setSelectedId}
					onCreate={() => void onCreate()}
					onDelete={setPendingDelete}
				/>

				<section className="flex min-w-0 flex-1 flex-col">
					{!selectedId ? (
						<div className="flex flex-1 items-center justify-center text-xs text-muted">
							Select a suite, or create one.
						</div>
					) : detail.isLoading ? (
						<div className="flex flex-1 items-center justify-center">
							<Spinner />
						</div>
					) : (
						<>
							<div className="flex items-center gap-3 border-b border-border px-4 py-2">
								<input
									className="min-w-0 flex-1 rounded-md border border-border bg-background-secondary px-2 py-1.5 text-sm font-medium text-foreground outline-none placeholder:text-muted focus:border-accent"
									placeholder="Suite name"
									aria-label="Suite name"
									value={draft.name}
									onChange={(e) => patch({ name: e.target.value })}
								/>
								<Button
									variant="outline"
									size="sm"
									isDisabled={isRunning}
									isPending={isRunning}
									onPress={() => void onRun([selectedId])}
								>
									<TbPlayerPlay size={15} /> {isRunning ? "Running…" : "Run suite"}
								</Button>
								<Button
									variant="primary"
									size="sm"
									isDisabled={!canSave}
									isPending={update.isPending}
									onPress={() => void onSave()}
								>
									Save
								</Button>
							</div>

							<div className="flex items-center gap-1 border-b border-border px-3">
								{EDITOR_TABS.map((name) => (
									<button
										key={name}
										type="button"
										onClick={() => setTab(name)}
										className={cn(
											"border-b-2 px-3 py-2 text-xs font-medium transition-colors",
											tab === name
												? "border-accent text-accent"
												: "border-transparent text-muted hover:text-foreground",
										)}
									>
										{name}
										{name === "Assertions" && assertionErrors.size > 0 && (
											<span className="ml-1 text-danger">•</span>
										)}
									</button>
								))}
							</div>

							<div className="min-h-0 flex-1 overflow-y-auto p-4">
								{tab === "Request" && (
									<RequestEditor
										draft={draft}
										routePath={route.data?.path}
										method={route.data?.method}
										onChange={patch}
									/>
								)}
								{tab === "Assertions" && (
									<AssertionsEditor
										assertions={draft.assertions}
										onChange={(assertions) => patch({ assertions })}
									/>
								)}
								{tab === "Overrides" && (
									<OverridesEditor projectId={projectId} draft={draft} onChange={patch} />
								)}
							</div>
						</>
					)}
				</section>

				<RunResults
					projectId={projectId}
					routeId={routeId}
					runId={runId}
					suiteNames={suiteNames}
					onSelectRun={setRunId}
				/>
			</div>

			<ConfirmDialog
				open={!!pendingDelete}
				onOpenChange={(open) => !open && setPendingDelete(null)}
				title="Delete test suite"
				confirmText="Delete"
				danger
				pending={remove.isPending}
				onConfirm={() => void onConfirmDelete()}
			>
				{pendingDelete?.name || "This suite"} and its assertions will be removed. Past run
				results are kept.
			</ConfirmDialog>
		</>
	);
}
