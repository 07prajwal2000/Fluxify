import { Button, Chip, CloseButton, Modal } from "@fluxify/components";
import { useState } from "react";
import type { Decision } from "@/services/agentConversations";
import { summarizeInput, type ToolRequest } from "./agentApproval";

type Props = {
	calls: ToolRequest[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The rows that got an answer; the rest keep waiting. */
	onConfirm: (decisions: Decision[]) => void;
};

/** Every call that waits, with its own Approve / Reject; sent together on Confirm. */
export function ReviewAllDialog({ calls, open, onOpenChange, onConfirm }: Props) {
	const [picks, setPicks] = useState<Record<string, boolean>>({});
	const rows = calls.filter((c): c is ToolRequest & { id: string } => Boolean(c.id));
	const set = (ids: string[], approve: boolean) =>
		setPicks((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, approve])) }));
	const decided = rows.filter((c) => c.id in picks);

	return (
		<Modal isOpen={open} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="lg" scroll="inside">
					<Modal.Dialog className="sm:max-w-3xl">
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>Review {rows.length} changes</Modal.Heading>
							<CloseButton />
						</Modal.Header>
						<Modal.Body>
							{/* Same columns and order as the rows below: Approve, then Reject. */}
							<div className="flex justify-end gap-1 pb-2">
								<Button
									size="sm"
									variant="primary"
									className="w-[5.5rem] whitespace-nowrap h-7 min-h-7 px-2 text-xs"
									onPress={() =>
										set(
											rows.filter((c) => !c.isDelete).map((c) => c.id),
											true,
										)
									}
								>
									Approve all
								</Button>
								{/* Deletes are never covered by Approve all: they need their own Approve. */}
								<Button
									size="sm"
									variant="danger-soft"
									className="w-[5.5rem] whitespace-nowrap h-7 min-h-7 px-2 text-xs"
									onPress={() =>
										set(
											rows.map((c) => c.id),
											false,
										)
									}
								>
									Reject all
								</Button>
							</div>
							<ul className="flex flex-col divide-y divide-border">
								{rows.map((c) => (
									<li key={c.id} className="flex items-center gap-3 py-2">
										<div className="flex min-w-0 flex-1 flex-col gap-0.5">
											<span className="flex items-center gap-2 text-sm text-foreground">
												<span className="font-medium">{c.title}</span>
												{c.isDelete && (
													<Chip size="sm" color="danger">
														Deletes
													</Chip>
												)}
											</span>
											<span className="truncate font-mono text-xs text-muted">
												{summarizeInput(c.name, c.input)}
											</span>
										</div>
										<div className="flex shrink-0 gap-1">
											<Button
												size="sm"
												variant={picks[c.id] === true ? "primary" : "ghost"}
												className={`w-[5.5rem] whitespace-nowrap h-7 min-h-7 px-2 text-xs ${picks[c.id] === true ? "" : "text-success"}`}
												aria-label={`Approve ${c.title}`}
												aria-pressed={picks[c.id] === true}
												onPress={() => set([c.id], true)}
											>
												Approve
											</Button>
											<Button
												size="sm"
												variant={picks[c.id] === false ? "danger-soft" : "ghost"}
												className={`w-[5.5rem] whitespace-nowrap h-7 min-h-7 px-2 text-xs ${picks[c.id] === false ? "" : "text-danger"}`}
												aria-label={`Reject ${c.title}`}
												aria-pressed={picks[c.id] === false}
												onPress={() => set([c.id], false)}
											>
												Reject
											</Button>
										</div>
									</li>
								))}
							</ul>
						</Modal.Body>
						<Modal.Footer>
							<Button variant="ghost" onPress={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button
								variant="primary"
								isDisabled={!decided.length}
								onPress={() =>
									onConfirm(decided.map((c) => ({ toolCallId: c.id, approve: picks[c.id] })))
								}
							>
								Confirm ({decided.length})
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
