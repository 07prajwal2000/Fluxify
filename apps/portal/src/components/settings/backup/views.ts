import type { BackupInterval, BackupRow } from "@/services/backups";

/** the inner tabs of Project settings > Backup; the open one lives in the URL (`backupView`) */
export const BACKUP_VIEWS = {
	backup: "Back up",
	schedule: "Schedule",
	git: "Git",
	history: "History",
	restore: "Restore & roll back",
} as const;

export type BackupView = keyof typeof BACKUP_VIEWS;

/** the route's validator: anything that isn't a tab is dropped, and the page opens on Back up */
export const parseBackupView = (value: unknown): BackupView | undefined =>
	typeof value === "string" && Object.hasOwn(BACKUP_VIEWS, value)
		? (value as BackupView)
		: undefined;

/**
 * The earliest the next scheduled backup can run, or null when it can't be told:
 * the platform checks once a day, so after a failure, or before the first
 * backup, it is simply "the next daily check". Mirrors `isDue` on the server.
 */
export function nextBackupAt(last: BackupRow | null, interval: BackupInterval): Date | null {
	if (last?.status !== "succeeded") return null;
	const next = new Date(last.createdAt);
	if (interval === "daily") next.setUTCDate(next.getUTCDate() + 1);
	else if (interval === "weekly") next.setUTCDate(next.getUTCDate() + 7);
	else next.setUTCMonth(next.getUTCMonth() + 1);
	return next;
}
