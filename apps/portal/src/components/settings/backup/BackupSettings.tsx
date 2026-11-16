import { Button, Checkbox, Spinner, toast } from "@fluxify/components";
import { useEffect, useRef, useState } from "react";
import { TbDownload } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import { backupsQuery } from "@/query/backupsQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { type BackupMode, backupsService } from "@/services/backups";
import { BackupHistory } from "./BackupHistory";
import { byteLength, triggerDownload } from "./format";
import { dependencyHint, labelOf, MODE_COPY, SECTION_LABELS } from "./labels";
import { ObjectStorageBackup } from "./ObjectStorageBackup";
import { README_MAX_BYTES, ReadmeField } from "./ReadmeField";

const README_KEY = "settings.backup.readme";

/**
 * Project settings > Backup (#1103): choose what goes in, make the archive, see
 * the history. The sections come from the server's registry, so a resource added
 * there is offered here without a change; `labels.ts` only names them.
 *
 * "Download backup" starts the run and, once that backup succeeds, the browser
 * downloads it. The history keeps the archive for a few days after that.
 */
export function BackupSettings({
	projectId,
	download = triggerDownload,
}: {
	projectId: string;
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
		<div className="flex flex-col gap-6">
			<div>
				<h1 className="text-xl font-semibold tracking-tight">Backup</h1>
				<p className="text-sm text-muted">
					Download a copy of this project, to keep or to create a new project from.
				</p>
			</div>

			<div role="radiogroup" aria-label="Kind of archive" className="grid gap-3 sm:grid-cols-2">
				{(Object.keys(MODE_COPY) as BackupMode[]).map((m) => (
					<button
						key={m}
						type="button"
						role="radio"
						aria-checked={mode === m}
						onClick={() => setMode(m)}
						className={`flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors ${
							mode === m
								? "border-accent bg-accent/10"
								: "border-border bg-surface hover:bg-surface-secondary"
						}`}
					>
						<span className="text-sm font-semibold text-foreground">{MODE_COPY[m].title}</span>
						<span className="text-xs text-muted">{MODE_COPY[m].body}</span>
					</button>
				))}
			</div>

			<fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
				<legend className="px-1 text-sm font-semibold text-foreground">What to include</legend>
				{sections.map(({ name }) => {
					const hint = dependencyHint(name, ticked, sections);
					return (
						<div key={name} className="flex flex-col gap-1">
							<Checkbox
								isSelected={ticked.has(name)}
								onChange={(on: boolean) => toggle(name, on)}
								label={labelOf(name)}
								description={SECTION_LABELS[name]?.description}
							/>
							{hint && (
								<p role="note" className="pl-7 text-xs text-warning">
									{hint}
								</p>
							)}
						</div>
					);
				})}
				<hr className="border-border" />
				<Checkbox
					isSelected={versionHistory}
					onChange={(on: boolean) => setVersionHistory(on)}
					label="Canvas version history"
					description="Every committed version, not only the live one. Larger archive."
				/>
				<Checkbox
					isSelected={!template && appConfigValues}
					isDisabled={template}
					onChange={(on: boolean) => setAppConfigValues(on)}
					label="App config values"
					description={
						template
							? "A template never carries values, only the names."
							: "The values too, not only the names. They are encrypted in the archive."
					}
				/>
			</fieldset>

			<ReadmeField value={readme} onChange={setEdited} highlight={template} />

			<div className="flex items-center gap-3">
				<Button
					variant="primary"
					onPress={submit}
					isDisabled={ticked.size === 0 || tooLong || running || start.isPending}
				>
					<TbDownload size={16} />
					Download backup
				</Button>
				{running && <span className="text-sm text-muted">A backup is running…</span>}
				{ticked.size === 0 && (
					<span className="text-sm text-muted">Pick at least one resource.</span>
				)}
			</div>

			<ObjectStorageBackup
				projectId={projectId}
				view={schedule}
				selection={{
					sections: [...ticked],
					includeVersionHistory: versionHistory,
					includeAppConfigValues: appConfigValues,
				}}
			/>

			<div className="flex flex-col gap-2">
				<h2 className="text-sm font-semibold text-foreground">History</h2>
				<BackupHistory
					projectId={projectId}
					rows={history.backups}
					retentionDays={history.retentionDays}
				/>
			</div>
		</div>
	);
}
