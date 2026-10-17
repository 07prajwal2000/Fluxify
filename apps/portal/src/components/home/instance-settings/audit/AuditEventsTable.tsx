import { Button, Chip, Table } from "@fluxify/components";
import { TbListDetails } from "react-icons/tb";
import { formatDateTime } from "@/lib/datetime";
import type { AuditRow } from "@/services/auditLogs";
import { actorLabel, projectLabel } from "./auditLabels";

const SHOWN_FIELDS = 3;

/** The exact ISO time on hover, the viewer's local time on screen. */
export function When({ ts }: { ts: string }) {
	return (
		<time dateTime={ts} title={ts} className="whitespace-nowrap">
			{formatDateTime(ts)}
		</time>
	);
}

export function ProjectCell({ row }: { row: AuditRow }) {
	return (
		<span className="flex flex-wrap items-center gap-1.5">
			{projectLabel(row)}
			{row.projectDeleted && (
				<Chip size="sm" color="warning">
					Deleted
				</Chip>
			)}
		</span>
	);
}

/** Property names only: the server never sends values. */
export function FieldChips({ fields, limit }: { fields: string[]; limit?: number }) {
	if (!fields.length) return <span className="text-muted">—</span>;
	const shown = limit ? fields.slice(0, limit) : fields;
	return (
		<span className="flex flex-wrap gap-1">
			{shown.map((f) => (
				<Chip key={f} size="sm">
					{f}
				</Chip>
			))}
			{shown.length < fields.length && (
				<Chip size="sm" variant="soft">
					+{fields.length - shown.length}
				</Chip>
			)}
		</span>
	);
}

export function AuditEventsTable({
	rows,
	onOpen,
}: {
	rows: AuditRow[];
	onOpen: (row: AuditRow) => void;
}) {
	return (
		<Table>
			<Table.Content aria-label="Audit events">
				<Table.Header>
					<Table.Column id="when" isRowHeader>
						When
					</Table.Column>
					<Table.Column id="who">Who</Table.Column>
					<Table.Column id="project">Project</Table.Column>
					<Table.Column id="resource">Resource</Table.Column>
					<Table.Column id="action">Action</Table.Column>
					<Table.Column id="changed">Changed</Table.Column>
					<Table.Column id="details" aria-label="Details">
						{""}
					</Table.Column>
				</Table.Header>
				<Table.Body items={rows}>
					{(row: AuditRow) => (
						<Table.Row id={row.id}>
							<Table.Cell>
								<When ts={row.ts} />
							</Table.Cell>
							<Table.Cell>{actorLabel(row)}</Table.Cell>
							<Table.Cell>
								<ProjectCell row={row} />
							</Table.Cell>
							<Table.Cell>
								<span className="flex flex-col">
									<span className="text-foreground">{row.resourceType}</span>
									<span className="font-mono text-xs text-muted">{row.resourceId}</span>
								</span>
							</Table.Cell>
							<Table.Cell>
								<span className="flex flex-col gap-0.5">
									<span className="flex items-center gap-1.5">
										{row.action}
										{row.status === "failure" && (
											<Chip size="sm" color="danger">
												Failed
											</Chip>
										)}
									</span>
									{row.message && (
										<span className="max-w-56 truncate text-xs text-muted" title={row.message}>
											{row.message}
										</span>
									)}
								</span>
							</Table.Cell>
							<Table.Cell>
								<FieldChips fields={row.changedFields} limit={SHOWN_FIELDS} />
							</Table.Cell>
							<Table.Cell>
								<Button
									isIconOnly
									variant="ghost"
									aria-label={`Details of ${row.action} ${row.resourceType}`}
									onPress={() => onOpen(row)}
								>
									<TbListDetails size={16} />
								</Button>
							</Table.Cell>
						</Table.Row>
					)}
				</Table.Body>
			</Table.Content>
		</Table>
	);
}
