import { Button, ButtonGroup, Chip, Dropdown, Label } from "@fluxify/components";
import { useState } from "react";
import { TbChevronDown, TbClipboardCheck, TbClock, TbTrash } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import type { Decision, Mode } from "@/services/agentConversations";
import { type ApprovalRequest, summarizeInput, type ToolRequest } from "./agentApproval";
import { ReviewAllDialog } from "./ReviewAllDialog";

type Props = {
	request: ApprovalRequest;
	/** Approve, and the mode the conversation goes on in (manual, or auto for "Approve with Auto"). */
	onApprove: (mode: Mode) => Promise<unknown>;
	/** Turn it down with no reason; typing in the editor turns it down with one. */
	onReject: () => Promise<unknown>;
	/** Every call that waits; with 2 or more, Approve all and Review all show up. */
	calls?: ToolRequest[];
	/** Answers the listed calls together; the rest keep waiting. */
	onDecide?: (decisions: Decision[]) => Promise<unknown>;
};

/**
 * Sits above the prompt editor while the agent waits for an answer: a change it
 * wants to make, or its finished plan in plan mode. Replaces cards and diffs in
 * the chat; the call itself stays a folded row there.
 */
export function ApprovalBar({ request, onApprove, onReject, calls = [], onDecide }: Props) {
	const [busy, setBusy] = useState(false);
	const [reviewing, setReviewing] = useState(false);
	const many = request.kind === "tool" && onDecide !== undefined && calls.length > 1;
	// Approve all never covers a delete: those need their own answer.
	const safe = calls.filter((c) => !c.isDelete && c.id);
	const deletes = calls.length - calls.filter((c) => !c.isDelete).length;
	const answer = (f: () => Promise<unknown>) => {
		setBusy(true);
		f()
			.catch(showErrorNotification)
			.finally(() => setBusy(false));
	};
	const del = request.kind === "tool" && request.isDelete;
	const Icon = del ? TbTrash : request.kind === "plan" ? TbClipboardCheck : TbClock;

	return (
		<section
			aria-label="Approval needed"
			className={`mb-2 flex flex-wrap items-center gap-3 rounded-2xl border px-3 py-2 ${
				del ? "border-danger/40 bg-danger/10" : "border-warning/40 bg-warning/10"
			}`}
		>
			<Icon size={18} className={`shrink-0 ${del ? "text-danger" : "text-warning"}`} />
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				{request.kind === "plan" ? (
					<>
						<span className="text-sm font-medium text-foreground">Plan ready</span>
						<span className="text-xs text-muted">Start it, or type below to change it.</span>
					</>
				) : (
					<>
						<span className="flex items-center gap-2 text-sm text-foreground">
							<span className="font-medium">{request.title}</span>
							{del && (
								<Chip size="sm" color="danger">
									Deletes
								</Chip>
							)}
						</span>
						<span className="truncate font-mono text-xs text-muted">
							{summarizeInput(request.name, request.input)}
						</span>
					</>
				)}
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-1">
				{many && (
					<>
						<Button size="sm" variant="ghost" isDisabled={busy} onPress={() => setReviewing(true)}>
							Review all
						</Button>
						{safe.length > 0 && (
							<Button
								size="sm"
								variant="secondary"
								isDisabled={busy}
								onPress={() =>
									answer(() =>
										onDecide(safe.map((c) => ({ toolCallId: c.id as string, approve: true }))),
									)
								}
							>
								{`Approve all (${safe.length})${
									deletes
										? ` · ${deletes} ${deletes === 1 ? "delete needs" : "deletes need"} review`
										: ""
								}`}
							</Button>
						)}
					</>
				)}
				<Button size="sm" variant="ghost" isDisabled={busy} onPress={() => answer(onReject)}>
					Reject
				</Button>
				<ButtonGroup size="sm" variant="primary" isDisabled={busy}>
					<Button onPress={() => answer(() => onApprove("manual"))}>Approve</Button>
					<Dropdown>
						<Button isIconOnly aria-label="More approve options">
							<ButtonGroup.Separator />
							<TbChevronDown size={14} />
						</Button>
						<Dropdown.Popover>
							<Dropdown.Menu onAction={() => answer(() => onApprove("auto"))}>
								<Dropdown.Item id="auto" textValue="Approve with Auto">
									<Label>Approve with Auto</Label>
								</Dropdown.Item>
							</Dropdown.Menu>
						</Dropdown.Popover>
					</Dropdown>
				</ButtonGroup>
			</div>
			{many && reviewing && (
				<ReviewAllDialog
					calls={calls}
					open
					onOpenChange={setReviewing}
					onConfirm={(d) => {
						setReviewing(false);
						answer(() => onDecide(d));
					}}
				/>
			)}
		</section>
	);
}
