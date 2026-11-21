import { Spinner, Tabs, toast } from "@fluxify/components";
import { useEffect, useRef, useState } from "react";
import { showErrorNotification } from "@/lib/errorNotifier";
import { backupsQuery } from "@/query/backupsQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { type BackupMode, backupsService } from "@/services/backups";
import { BackupForm } from "./BackupForm";
import { BackupHistory } from "./BackupHistory";
import { BackupStatusHeader } from "./BackupStatusHeader";
import { byteLength, triggerDownload } from "./format";
import { GitBackup } from "./GitBackup";
import { ObjectStorageBackup } from "./ObjectStorageBackup";
import { README_MAX_BYTES } from "./ReadmeField";
import { RemoteBackups } from "./RemoteBackups";
import { RollbackUpload } from "./RollbackUpload";
import { BACKUP_VIEWS, type BackupView } from "./views";

const README_KEY = "settings.backup.readme";

/**
 * Project settings > Backup (#1103, #1131): a status header that is always
 * there, and four tabs under it: Back up, Schedule, History, and Restore &
 * roll back. The open tab is the route's `backupView` search param, passed in.
 * The sections come from the server's registry, so a resource added there is
 * offered here without a change; `labels.ts` only names them.
 *
 * "Download backup" starts the run and, once that backup succeeds, the browser
 * downloads it. The history keeps the archive for a few days after that.
 */
export function BackupSettings({
	projectId,
	view = "backup",
	onViewChange = () => {},
	download = triggerDownload,
}: {
	projectId: string;
	view?: BackupView;
	onViewChange?: (view: BackupView) => void;
	/** how the archive reaches the user; replaced in tests */
	download?: (url: string) => void;
}) {
	const { data: sections } = backupsQuery.sections.useQuery(projectId);
	const { data: history } = backupsQuery.list.useQuery(projectId);
	const { data: settings } = projectSettingsKeysQuery.getAll.useQuery(projectId);
	// the resources and options the object storage backup uses (#1106); the form starts from them
	const { data: schedule } = backupsQuery.schedule.useQuery(projectId);
	const start = backupsQuery.start.useMutation(projectId);

	const [mode, setMode] = useState<BackupMode>("backup");
	// undefined until edited: what the object storage backup uses
	const [picked, setPicked] = useState<Set<string>>();
	const [historyEdited, setVersionHistory] = useState<boolean>();
	const [valuesEdited, setAppConfigValues] = useState<boolean>();
	// undefined until edited: the README the last backup used
	const [edited, setEdited] = useState<string>();
	const readme = edited ?? (settings as Record<string, string> | undefined)?.[README_KEY] ?? "";
	// the run this page started, downloaded once it succeeds
	const waiting = useRef<string | null>(null);

	useEffect(() => {
		const row = history?.backups.find((b) => b.id === waiting.current);
		if (!row || row.status === "running") return;
		waiting.current = null;
		if (row.status === "succeeded") download(backupsService.downloadUrl(projectId, row.id));
	}, [history, download, projectId]);

	if (!sections || !history || !schedule) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}

	const saved = schedule.schedule;
	const ticked =
		picked ?? new Set(sections.map((s) => s.name).filter((n) => saved.sections.includes(n)));
	const versionHistory = historyEdited ?? saved.includeVersionHistory;
	const appConfigValues = valuesEdited ?? saved.includeAppConfigValues;
	const running = history.backups.some((b) => b.status === "running");
	const template = mode === "template";
	const tooLong = byteLength(readme) > README_MAX_BYTES;

	const toggle = (name: string, on: boolean) => {
		const next = new Set(ticked);
		if (on) next.add(name);
		else next.delete(name);
		setPicked(next);
	};

	const submit = () =>
		start.mutate(
			{
				mode,
				sections: [...ticked],
				includeVersionHistory: versionHistory,
				// a template never carries values
				includeAppConfigValues: !template && appConfigValues,
				readme,
			},
			{
				onSuccess: ({ id }) => {
					waiting.current = id;
					toast.success("Backup started. It downloads when it is ready.");
				},
				onError: (e) => showErrorNotification(e as Error),
			},
		);

	return (
		<div className="flex flex-col gap-4">
			<h1 className="sr-only">Backup</h1>

			<BackupStatusHeader
				projectId={projectId}
				history={history.backups}
				view={schedule}
				note={
					running
						? "A backup is running…"
						: ticked.size === 0
							? "Pick at least one resource."
							: undefined
				}
				canDownload={ticked.size > 0 && !tooLong && !running}
				downloading={start.isPending}
				onDownload={submit}
				onOpenHistory={() => onViewChange("history")}
			/>

			<Tabs
				variant="secondary"
				selectedKey={view}
				onSelectionChange={(key) => onViewChange(key as BackupView)}
			>
				<Tabs.ListContainer>
					<Tabs.List aria-label="Backup">
						{(Object.keys(BACKUP_VIEWS) as BackupView[]).map((id) => (
							<Tabs.Tab key={id} id={id}>
								{BACKUP_VIEWS[id]}
								<Tabs.Indicator />
							</Tabs.Tab>
						))}
					</Tabs.List>
				</Tabs.ListContainer>
			</Tabs>

			{view === "backup" && (
				<BackupForm
					sections={sections}
					ticked={ticked}
					onToggle={toggle}
					mode={mode}
					onMode={setMode}
					versionHistory={versionHistory}
					onVersionHistory={setVersionHistory}
					appConfigValues={appConfigValues}
					onAppConfigValues={setAppConfigValues}
					readme={readme}
					onReadme={setEdited}
				/>
			)}
			{view === "schedule" && (
				<ObjectStorageBackup
					projectId={projectId}
					view={schedule}
					selection={{
						sections: [...ticked],
						includeVersionHistory: versionHistory,
						includeAppConfigValues: appConfigValues,
					}}
				/>
			)}
			{view === "git" && <GitBackup projectId={projectId} history={history.backups} />}
			{view === "history" && (
				<BackupHistory
					projectId={projectId}
					rows={history.backups}
					retentionDays={history.retentionDays}
				/>
			)}
			{view === "restore" && (
				<div className="flex flex-col gap-6">
					<RollbackUpload projectId={projectId} />
					<RemoteBackups projectId={projectId} view={schedule} />
				</div>
			)}
		</div>
	);
}
