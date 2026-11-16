import { Button, Chip, toast } from "@fluxify/components";
import { TbCloudUpload, TbDownload, TbLock } from "react-icons/tb";
import { useEnterpriseStorageBackups } from "@/components/common/Enterprise";
import { formatDateTime, getTimeAgo } from "@/lib/datetime";
import { showErrorNotification } from "@/lib/errorNotifier";
import { backupsQuery } from "@/query/backupsQuery";
import type { BackupRow, BackupScheduleView } from "@/services/backups";
import { nextBackupAt } from "./views";

const RESULT = {
	running: { label: "Running", color: "warning" },
	succeeded: { label: "Succeeded", color: "success" },
	failed: { label: "Failed", color: "danger" },
} as const;

function LastBackup({ row, onOpen }: { row: BackupRow | undefined; onOpen: () => void }) {
	if (!row) return <span className="text-sm text-muted">No backups yet</span>;
	const result = RESULT[row.status];
	return (
		<>
			<span className="flex flex-wrap items-center gap-2 text-sm text-foreground">
				<Chip size="sm" variant="soft" color={result.color}>
					{result.label}
				</Chip>
				<button
					type="button"
					onClick={onOpen}
					title={formatDateTime(row.createdAt)}
					className="text-accent hover:underline"
				>
					{getTimeAgo(row.createdAt)}
				</button>
			</span>
			{row.status === "failed" && row.error && (
				<span role="alert" className="max-w-md text-xs text-danger [overflow-wrap:anywhere]">
					{row.error}
				</span>
			)}
		</>
	);
}

function NextBackup({ view, licensed }: { view: BackupScheduleView; licensed: boolean }) {
	const { schedule, lastRun } = view;
	if (!licensed)
		return (
			<Chip size="sm" color="warning" className="gap-1">
				<TbLock size={12} />
				Enterprise
			</Chip>
		);
	if (!schedule.enabled || !schedule.integrationId || !schedule.prefix)
		return <span className="text-sm text-muted">Scheduled backups off</span>;
	const next = nextBackupAt(lastRun, schedule.interval);
	return (
		<span className="text-sm text-foreground">
			{next ? `On or after ${formatDateTime(next)}` : "At the next daily check"}
		</span>
	);
}

/**
 * Always visible above the Backup tabs (#1131): the last backup, the next
 * scheduled one, and the two actions. "Back up now" needs a saved destination.
 * The note says why Download is waiting.
 */
export function BackupStatusHeader({
	projectId,
	history,
	view,
	note,
	canDownload,
	downloading,
	onDownload,
	onOpenHistory,
}: {
	projectId: string;
	history: BackupRow[];
	view: BackupScheduleView;
	note?: string;
	canDownload: boolean;
	downloading: boolean;
	onDownload: () => void;
	onOpenHistory: () => void;
}) {
	const licensed = useEnterpriseStorageBackups();
	const now = backupsQuery.backupNow.useMutation(projectId);
	const { schedule } = view;
	const configured = Boolean(schedule.integrationId && schedule.prefix);
	const running = history.some((b) => b.status === "running");

	return (
		<div
			role="region"
			aria-label="Backup status"
			className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-border bg-surface px-4 py-3"
		>
			<div className="flex flex-wrap items-center gap-x-8 gap-y-2">
				<div className="flex flex-col gap-0.5">
					<span className="text-xs text-muted">Last backup</span>
					<LastBackup row={history[0]} onOpen={onOpenHistory} />
				</div>
				<div className="flex flex-col gap-0.5">
					<span className="text-xs text-muted">Next scheduled backup</span>
					<NextBackup view={view} licensed={licensed} />
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-3">
				{note && <span className="text-sm text-muted">{note}</span>}
				{licensed && configured && (
					<Button
						variant="secondary"
						isDisabled={running}
						isPending={now.isPending}
						onPress={() =>
							now.mutate(undefined, {
								onSuccess: () => toast.success("Backup started."),
								onError: (e) => showErrorNotification(e as Error),
							})
						}
					>
						<TbCloudUpload size={16} />
						Back up now
					</Button>
				)}
				<Button
					variant="primary"
					onPress={onDownload}
					isDisabled={!canDownload}
					isPending={downloading}
				>
					<TbDownload size={16} />
					Download backup
				</Button>
			</div>
		</div>
	);
}
