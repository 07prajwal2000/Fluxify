import { Chip, Spinner, Table } from "@fluxify/components";
import { formatDateTime, getTimeAgo } from "@/lib/datetime";
import type { BackupRow } from "@/services/backups";
import { backupsService } from "@/services/backups";
import { formatBytes } from "./format";

const STATUS = {
	running: { label: "Running", color: "warning" },
	succeeded: { label: "Succeeded", color: "success" },
	failed: { label: "Failed", color: "danger" },
} as const;

const TYPES = { manual: "Manual", object_storage: "Object storage" } as const;

/** the last cell: the way to the file, or why there isn't one */
function Outcome({ projectId, row, days }: { projectId: string; row: BackupRow; days: number }) {
	if (row.status === "failed")
		return <span className="text-danger [overflow-wrap:anywhere]">{row.error}</span>;
	if (row.status === "running") return <Spinner size="sm" />;
	if (!row.downloadable)
		return (
			<span className="text-muted" title={row.destinationKey ?? undefined}>
				{row.type === "object_storage" ? "In object storage" : `Expired (kept ${days} days)`}
			</span>
		);
	return (
		<a
			href={backupsService.downloadUrl(projectId, row.id)}
			download
			className="text-accent hover:underline"
		>
			Download
		</a>
	);
}

/** Every backup of the project, newest first; a failed one shows its error where the download would be. */
export function BackupHistory({
	projectId,
	rows,
	retentionDays,
}: {
	projectId: string;
	rows: BackupRow[];
	retentionDays: number;
}) {
	if (rows.length === 0)
		return <p className="text-sm text-muted">No backups yet. The ones you make appear here.</p>;
	return (
		<Table>
			<Table.Content aria-label="Backup history">
				<Table.Header>
					<Table.Column id="status" isRowHeader>
						Status
					</Table.Column>
					<Table.Column id="type">Type</Table.Column>
					<Table.Column id="mode">Mode</Table.Column>
					<Table.Column id="release">Release</Table.Column>
					<Table.Column id="size">Size</Table.Column>
					<Table.Column id="by">Started by</Table.Column>
					<Table.Column id="when">When</Table.Column>
					<Table.Column id="file">Archive</Table.Column>
				</Table.Header>
				<Table.Body>
					{rows.map((row) => (
						<Table.Row key={row.id} id={row.id}>
							<Table.Cell>
								<Chip size="sm" variant="soft" color={STATUS[row.status].color}>
									{STATUS[row.status].label}
								</Chip>
							</Table.Cell>
							<Table.Cell>{TYPES[row.type]}</Table.Cell>
							<Table.Cell className="capitalize">{row.mode}</Table.Cell>
							<Table.Cell>{row.release ?? "—"}</Table.Cell>
							<Table.Cell>{formatBytes(row.sizeBytes)}</Table.Cell>
							<Table.Cell>{row.createdBy?.name || row.createdBy?.email || "—"}</Table.Cell>
							<Table.Cell>
								<span title={formatDateTime(row.createdAt)}>{getTimeAgo(row.createdAt)}</span>
							</Table.Cell>
							<Table.Cell className="max-w-xs">
								<Outcome projectId={projectId} row={row} days={retentionDays} />
							</Table.Cell>
						</Table.Row>
					))}
				</Table.Body>
			</Table.Content>
		</Table>
	);
}
