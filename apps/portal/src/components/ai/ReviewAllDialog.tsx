import { Button, Chip, CloseButton, Modal } from "@fluxify/components";
import { useState } from "react";
import type { Decision } from "@/services/agentConversations";
import { ApprovalTarget } from "./ApprovalTarget";
import { displayToolName, externalServerOf, type ToolRequest } from "./agentApproval";
import { DeployComment } from "./DeployComment";
import { RowPreview } from "./RowPreview";

type Props = {
	/** the project a promote or rollback links its version canvas in */
	projectId: string;
	calls: ToolRequest[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The rows that got an answer; the rest keep waiting. */
	onConfirm: (decisions: Decision[]) => void;
};

const omit = (picks: Record<string, boolean>, id: string) =>
	Object.fromEntries(Object.entries(picks).filter(([key]) => key !== id));

/** Every call that waits, with its own Approve / Reject; sent together on Confirm. */
export function ReviewAllDialog({ projectId, calls, open, onOpenChange, onConfirm }: Props) {
	const [picks, setPicks] = useState<Record<string, boolean>>({});
	// promote and rollback each carry their own reason (#739)
	const [comments, setComments] = useState<Record<string, string>>({});
	const rows = calls.filter((c): c is ToolRequest & { id: string } => Boolean(c.id));
	const set = (ids: string[], approve: boolean) =>
		setPicks((p) => ({ ...p, ...Object.fromEntries(ids.map((id) => [id, approve])) }));
	const decided = rows.filter((c) => c.id in picks);
	const comment = (id: string) => comments[id]?.trim() ?? "";
	const write = (id: string, value: string) => {
		setComments((c) => ({ ...c, [id]: value }));
		// an approval is only as good as its reason: clearing it takes the approval back
		if (!value.trim()) setPicks((p) => (p[id] === true ? omit(p, id) : p));
	};

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
											rows.filter((c) => !c.isDelete && !c.needsComment).map((c) => c.id),
											true,
										)
									}
								>
									Approve all
								</Button>
								{/* Deletes and deployments are never covered by Approve all: they need their own Approve. */}
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
									<li key={c.id} className="flex flex-col gap-2 py-2">
										<div className="flex items-center gap-3">
											<div className="flex min-w-0 flex-1 flex-col gap-0.5">
												{(() => {
													const server = c.server ?? externalServerOf(c.name);
													return (
														<span className="flex items-center gap-2 text-sm text-foreground">
															{server && (
																<Chip size="sm" variant="secondary" className="font-mono text-xs">
																	{server}
																</Chip>
															)}
															<span className="font-medium">{displayToolName(c)}</span>
															{c.isDelete && (
																<Chip size="sm" color="danger">
																	Deletes
																</Chip>
															)}
															{c.isProd && (
																<Chip size="sm" color="danger">
																	Production
																</Chip>
															)}
														</span>
													);
												})()}
												<ApprovalTarget projectId={projectId} name={c.name} input={c.input} />
											</div>
											<div className="flex shrink-0 gap-1">
												<Button
													size="sm"
													variant={picks[c.id] === true ? "primary" : "ghost"}
													className={`w-[5.5rem] whitespace-nowrap h-7 min-h-7 px-2 text-xs ${picks[c.id] === true ? "" : "text-success"}`}
													aria-label={`Approve ${c.title}`}
													aria-pressed={picks[c.id] === true}
													isDisabled={c.needsComment && !comment(c.id)}
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
										</div>
										{c.needsComment && (
											<DeployComment
												label={`Why: ${c.title}`}
												value={comments[c.id] ?? ""}
												onChange={(value) => write(c.id, value)}
											/>
										)}
										<RowPreview call={c} />
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
									onConfirm(
										decided.map((c) => ({
											toolCallId: c.id,
											approve: picks[c.id],
											...(picks[c.id] && c.needsComment && { comment: comment(c.id) }),
										})),
									)
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
