import { Button, Chip, Dropdown, Label } from "@fluxify/components";
import { useState } from "react";
import { TbChevronDown, TbClipboardCheck, TbClock, TbTrash } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import type { Mode } from "@/services/agentConversations";
import { type ApprovalRequest, summarizeInput } from "./agentApproval";

type Props = {
	request: ApprovalRequest;
	/** Approve, and the mode the conversation goes on in (manual, or auto for "Approve with Auto"). */
	onApprove: (mode: Mode) => Promise<unknown>;
	/** Turn it down with no reason; typing in the editor turns it down with one. */
	onReject: () => Promise<unknown>;
};

/**
 * Sits above the prompt editor while the agent waits for an answer: a change it
 * wants to make, or its finished plan in plan mode. Replaces cards and diffs in
 * the chat; the call itself stays a folded row there.
 */
export function ApprovalBar({ request, onApprove, onReject }: Props) {
	const [busy, setBusy] = useState(false);
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
							<span className="font-mono">{request.name}</span>
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
			<div className="flex shrink-0 items-center gap-1">
				<Button size="sm" variant="ghost" isDisabled={busy} onPress={() => answer(onReject)}>
					Reject
				</Button>
				<Button
					size="sm"
					variant="primary"
					className="rounded-r-none"
					isDisabled={busy}
					onPress={() => answer(() => onApprove("manual"))}
				>
					Approve
				</Button>
				<Dropdown>
					<Button
						isIconOnly
						size="sm"
						variant="primary"
						className="-ml-1 rounded-l-none border-l border-accent-foreground/20"
						aria-label="More approve options"
						isDisabled={busy}
					>
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
			</div>
		</section>
	);
}
