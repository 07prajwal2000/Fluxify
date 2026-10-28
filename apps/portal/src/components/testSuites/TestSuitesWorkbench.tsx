import { Button, cn, Spinner, toast } from "@fluxify/components";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { TbListCheck, TbPlayerPlay, TbPlus } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EnvPicker, type RunEnv } from "@/components/common/EnvPicker";
import { RouteWorkbenchHeader } from "@/components/routes/RouteWorkbenchTabs";
import { ProductionChip } from "@/components/versions/ProductionChip";
import { useVersionTarget } from "@/components/versions/useVersionTarget";
import { showErrorNotification } from "@/lib/errorNotifier";
import { useProjectPackageTypes } from "@/query/projectPackagesQuery";
import { routesQuery } from "@/query/routesQuery";
import { testSuitesQuery } from "@/query/testSuitesQuery";
import { IN_FLIGHT_STATUSES, type SuiteTarget } from "@/services/testSuites";
import { AssertionsEditor } from "./AssertionsEditor";
import { validateAssertions } from "./assertions";
import { CloneSuiteDialog } from "./CloneSuiteDialog";
import { HooksEditor } from "./HooksEditor";
import { hookErrors } from "./hooks";
import { InputEditor } from "./InputEditor";
import { selectionAfterDelete } from "./nextSelection";
import { OverridesEditor } from "./OverridesEditor";
import { RequestEditor } from "./RequestEditor";
import { RunBulkDialog } from "./RunBulkDialog";
import { RunResults } from "./RunResults";
import { SetupEditor } from "./SetupEditor";
import { SuiteList } from "./SuiteList";
import { type SuiteDraft, toDraft } from "./types";

/** a route suite sends a request; a workflow suite feeds an input (#487) */
const EDITOR_TABS = {
	route: ["Request", "Assertions", "Hooks", "Setup & teardown", "Overrides"],
	workflow: ["Input", "Assertions", "Hooks", "Setup & teardown", "Overrides"],
} as const;

type EditorTab = (typeof EDITOR_TABS)[SuiteTarget["type"]][number];

/**
 * Create, edit and run the suites of one route or workflow. `headerLeft` is the
 * target's own switcher and view tabs.
 */
export function TestSuitesWorkbench({
	projectId,
	target,
	headerLeft,
	initialRunId,
	initialSuiteId,
	onViewChange,
}: {
	projectId: string;
	target: SuiteTarget;
	headerLeft: ReactNode;
	/** the suite picked or the run shown changed: the page keeps both in its URL */
	onViewChange?: (view: { suiteId: string; runId: string | null }) => void;
	/** a test trace's "From test" link opens its run's results (#627) */
	initialRunId?: string;
	/** a link from the agent chat opens this suite instead of the first */
	initialSuiteId?: string;
}) {
	// npm package types, so imports in scripts and hooks autocomplete (faker…)
	useProjectPackageTypes(projectId);
	const tabs = EDITOR_TABS[target.type];
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [tab, setTab] = useState<EditorTab>(tabs[0]);
	const [draft, setDraft] = useState<SuiteDraft>(() => toDraft(undefined));
	const [isDirty, setDirty] = useState(false);
	const [runId, setRunId] = useState<string | null>(initialRunId ?? null);
	useEffect(() => {
		if (initialRunId) setRunId(initialRunId);
	}, [initialRunId]);
	const [shownRunId, setShownRunId] = useState<string | null>(null);
	const reportView = useRef(onViewChange);
	reportView.current = onViewChange;
	useEffect(() => {
		// nothing to say until a suite is picked, or a link's suite would be dropped
		if (selectedId) reportView.current?.({ suiteId: selectedId, runId: shownRunId });
	}, [selectedId, shownRunId]);
	const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
	const [pendingClone, setPendingClone] = useState<{ id: string; name: string } | null>(null);

	const route = routesQuery.byId.useQuery(target.type === "route" ? target.id : "");
	const { prodVersionNumber } = useVersionTarget(target.type, target.id);
	const [env, setEnv] = useState<RunEnv>("development");
	const [bulkOpen, setBulkOpen] = useState(false);
	const suites = testSuitesQuery.getAll.useQuery(target);
	const detail = testSuitesQuery.getById.useQuery(target, selectedId);
	const create = testSuitesQuery.create.mutation(target);
	const update = testSuitesQuery.update.mutation(target, selectedId ?? "");
	const remove = testSuitesQuery.remove.mutation(target);
	const startRun = testSuitesQuery.startRun.mutation(projectId, target);
	// Same query key the results panel polls, so react-query serves both from one
	// request — this is only here to know when the run is still moving.
	const activeRun = testSuitesQuery.getRun.useQuery(projectId, target, runId);
	const isRunning =
		startRun.isPending ||
		(!!runId && (!activeRun.data || IN_FLIGHT_STATUSES.includes(activeRun.data.status)));

	// A failed teardown leaves the suite's result alone, which makes it easy to
	// miss — say so once, when the run finishes (#483).
	const warnedRuns = useRef(new Set<string>());
	useEffect(() => {
		const run = activeRun.data;
		if (!runId || !run || IN_FLIGHT_STATUSES.includes(run.status)) return;
		if (warnedRuns.current.has(runId)) return;
		warnedRuns.current.add(runId);
		const broken = run.suiteRuns.filter(
			(s) => (s.result as { teardownError?: string } | null)?.teardownError,
		).length;
		if (broken > 0) {
			toast.warning(
				`Teardown failed in ${broken} suite${broken === 1 ? "" : "s"}. Test data may be left behind; open the results for details.`,
			);
		}
	}, [runId, activeRun.data]);

	const list = useMemo(
		() =>
			(suites.data ?? []).map((suite) => ({
				id: suite.id ?? "",
				name: suite.name ?? "",
				enabled: suite.enabled ?? true,
			})),
		[suites.data],
	);

	const suiteNames = useMemo(
		() => Object.fromEntries(list.map((suite) => [suite.id, suite.name])),
		[list],
	);

	// Open the first suite once the list arrives, so the editor is never blank
	// when there is something to show. A link to a run with no suite named opens
	// one that ran in it, so the results panel has something to show.
	useEffect(() => {
		if (selectedId || list.length === 0) return;
		if (initialRunId && !initialSuiteId && activeRun.isLoading) return;
		const ranInLink = activeRun.data?.suiteRuns
			.map((s) => s.testSuiteId)
			.find((id) => list.some((s) => s.id === id));
		setSelectedId(list.find((s) => s.id === initialSuiteId)?.id ?? ranInLink ?? list[0].id);
	}, [list, selectedId, initialSuiteId, initialRunId, activeRun.isLoading, activeRun.data]);

	// Seed the form from the loaded suite. Keyed on the suite id, not the query
	// data, so a background refetch cannot wipe unsaved edits.
	useEffect(() => {
		if (detail.data) {
			setDraft(toDraft(detail.data));
			setDirty(false);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- reseed per suite, not per refetch
	}, [detail.data?.id, detail.data]);

	const assertionErrors = validateAssertions(draft.assertions);
	const hookErrorCount = hookErrors(draft.hooks).size;
	const canSave =
		isDirty && assertionErrors.size === 0 && hookErrorCount === 0 && draft.name.trim().length > 0;

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
				projectId,
				headers: draft.headers,
				queryParams: draft.queryParams,
				routeParams: draft.routeParams,
				params: {},
				body: draft.body ?? null,
				assertions: draft.assertions,
				appConfigOverrides: draft.appConfigOverrides,
				integrationOverrides: draft.integrationOverrides,
				hooks: draft.hooks,
				setupBlockId: draft.setupBlockId,
				teardownBlockId: draft.teardownBlockId,
				setupTimeoutMs: draft.setupTimeoutMs,
				teardownTimeoutMs: draft.teardownTimeoutMs,
				runAlone: draft.runAlone,
				enabled: draft.enabled,
				...(target.type === "workflow" && { input: draft.input }),
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
			const { runId: id } = await startRun.mutateAsync({ suiteIds, env });
			setRunId(id);
		} catch (error) {
			showErrorNotification(error as Error);
		}
	}

	async function onRunBulk(ids: string[]) {
		await onRun(ids);
		setBulkOpen(false);
	}

	async function onConfirmDelete() {
		if (!pendingDelete) return;
		try {
			await remove.mutateAsync(pendingDelete.id);
			const next = selectionAfterDelete(list, pendingDelete.id, selectedId);
			if (next !== selectedId) {
				// the old suite's edits must not leak into the next one (or the empty state)
				setDraft(toDraft(undefined));
				setDirty(false);
				setSelectedId(next);
			}
			setPendingDelete(null);
		} catch (error) {
			showErrorNotification(error as Error);
		}
	}

	return (
		<>
			<RouteWorkbenchHeader>
				{headerLeft}
				<div className="ml-auto flex items-center gap-3">
					<ProductionChip kind={target.type} id={target.id} projectId={projectId} />
					<span className="text-xs text-muted">
						{list.length} suite{list.length === 1 ? "" : "s"}
					</span>
					<EnvPicker
						env={env}
						onEnvChange={setEnv}
						productionDisabled={prodVersionNumber == null}
						confirm="Runs your production version with development credentials. Production data is never touched."
					/>
					<Button
						variant="outline"
						isDisabled={!list.some((s) => s.enabled) || isRunning}
						isPending={isRunning}
						onPress={() => void onRun()}
					>
						<TbPlayerPlay size={16} /> {isRunning ? "Running…" : "Run all"}
					</Button>
					<Button
						variant="outline"
						isDisabled={list.length === 0 || isRunning}
						onPress={() => setBulkOpen(true)}
					>
						<TbListCheck size={16} /> Run bulk actions
					</Button>
					<Button variant="primary" isPending={create.isPending} onPress={() => void onCreate()}>
						<TbPlus size={16} /> New suite
					</Button>
				</div>
			</RouteWorkbenchHeader>

			<div className="flex min-h-0 flex-1">
				<SuiteList
					kind={target.type}
					suites={list}
					isLoading={suites.isLoading}
					selectedId={selectedId}
					isCreating={create.isPending}
					onSelect={setSelectedId}
					onCreate={() => void onCreate()}
					onClone={setPendingClone}
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
								{tabs.map((name) => (
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
										{((name === "Assertions" && assertionErrors.size > 0) ||
											(name === "Hooks" && hookErrorCount > 0)) && (
											<span className="ml-1 text-danger">•</span>
										)}
									</button>
								))}
							</div>

							<div className="min-h-0 flex-1 overflow-y-auto p-4">
								{tab === "Request" && (
									<RequestEditor
										// the body editor holds local state, seeded per suite
										key={selectedId}
										draft={draft}
										route={route.data}
										onChange={patch}
									/>
								)}
								{tab === "Input" && (
									<InputEditor
										// the JSON editors hold local text, seeded per suite
										key={selectedId}
										projectId={projectId}
										input={draft.input}
										onChange={(input) => patch({ input })}
									/>
								)}
								{tab === "Assertions" && (
									<AssertionsEditor
										kind={target.type}
										routeId={target.type === "route" ? target.id : undefined}
										assertions={draft.assertions}
										onChange={(assertions) => patch({ assertions })}
									/>
								)}
								{tab === "Hooks" && (
									<HooksEditor
										suiteId={selectedId}
										target={target}
										hooks={draft.hooks}
										onChange={(hooks) => patch({ hooks })}
									/>
								)}
								{tab === "Setup & teardown" && (
									<SetupEditor projectId={projectId} draft={draft} onChange={patch} />
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
					target={target}
					runId={runId}
					suiteId={selectedId}
					suiteNames={suiteNames}
					onSelectRun={setRunId}
					onShownRunChange={setShownRunId}
				/>
			</div>

			<RunBulkDialog
				open={bulkOpen}
				suites={list}
				pending={isRunning}
				onClose={() => setBulkOpen(false)}
				onRun={(ids) => void onRunBulk(ids)}
			/>

			<CloneSuiteDialog
				projectId={projectId}
				target={target}
				suite={pendingClone}
				onClose={() => setPendingClone(null)}
				// a copy on this same target opens right away, like a new suite
				onCloned={(id, to) => to.type === target.type && to.id === target.id && setSelectedId(id)}
			/>

			<ConfirmDialog
				open={!!pendingDelete}
				onOpenChange={(open) => !open && setPendingDelete(null)}
				title="Delete test suite"
				confirmText="Delete"
				danger
				pending={remove.isPending}
				onConfirm={() => void onConfirmDelete()}
			>
				{pendingDelete?.name || "This suite"} and its assertions will be removed. Past run results
				are kept.
			</ConfirmDialog>
		</>
	);
}
