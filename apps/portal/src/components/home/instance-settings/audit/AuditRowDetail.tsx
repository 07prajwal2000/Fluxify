import { CloseButton, Modal } from "@fluxify/components";
import type { ReactNode } from "react";
import type { AuditRow } from "@/services/auditLogs";
import { FieldChips, ProjectCell, When } from "./AuditEventsTable";
import { actorLabel } from "./auditLabels";

function Line({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="grid grid-cols-[7rem_1fr] gap-2 text-sm">
			<dt className="text-muted">{label}</dt>
			<dd className="min-w-0 break-words text-foreground">{children}</dd>
		</div>
	);
}

/** The whole event, for when the table row is too cramped to show it. */
export function AuditRowDetail({ row, onClose }: { row: AuditRow | null; onClose: () => void }) {
	return (
		<Modal isOpen={!!row} onOpenChange={(open) => !open && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="md">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>Audit event</Modal.Heading>
							<CloseButton onPress={onClose} />
						</Modal.Header>
						<Modal.Body>
							{row && (
								<dl className="flex flex-col gap-3">
									<Line label="When">
										<When ts={row.ts} />
										<span className="ml-2 font-mono text-xs text-muted">{row.ts}</span>
									</Line>
									<Line label="Who">{actorLabel(row)}</Line>
									<Line label="Project">
										<ProjectCell row={row} />
										{row.projectId && (
											<span className="font-mono text-xs text-muted">{row.projectId}</span>
										)}
									</Line>
									<Line label="Resource">
										{row.resourceType}{" "}
										<span className="font-mono text-xs text-muted">{row.resourceId}</span>
									</Line>
									<Line label="Action">{row.action}</Line>
									<Line label="Result">{row.status === "success" ? "Succeeded" : "Failed"}</Line>
									<Line label="Changed">
										<FieldChips fields={row.changedFields} />
									</Line>
									{row.message && <Line label="Message">{row.message}</Line>}
								</dl>
							)}
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
