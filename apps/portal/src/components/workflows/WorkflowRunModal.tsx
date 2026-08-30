import { useState } from "react";
import {
	Alert,
	Button,
	CloseButton,
	Label,
	Modal,
	TextArea,
	toast,
} from "@fluxify/components";
import { TbInfoCircle, TbPlayerPlay } from "react-icons/tb";
import { workflowsQuery } from "@/query/workflowsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";

const EXAMPLE = `{
  "customerId": "cus_1024",
  "attachment": {
    "mediaType": "application/pdf",
    "encoding": "base64",
    "data": "JVBERi0xLjQK..."
  }
}`;

/**
 * Whatever the user typed, as the workflow will receive it: JSON when it parses
 * as JSON, otherwise the raw text. A workflow triggered by plain text has to be
 * testable with plain text, and quoting it by hand would be a trap.
 */
export function parsePayload(input: string): unknown {
	const text = input.trim();
	if (!text) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

export function WorkflowRunModal({
	workflowId,
	name,
	isOpen,
	onOpenChange,
}: {
	workflowId: string;
	name: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [payload, setPayload] = useState("");
	const run = workflowsQuery.run.mutation(workflowId);
	const parsed = parsePayload(payload);
	const isJson = typeof parsed === "object" && parsed !== null;

	function start() {
		run.mutate(parsed, {
			onSuccess: (result) => {
				toast.success(`Run queued — ${result.id}`);
				onOpenChange(false);
			},
			onError: (error) => showErrorNotification(error as Error),
		});
	}

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center">
					<Modal.Dialog className="w-[38rem] max-w-[92vw]">
						<Modal.Header className="flex flex-row items-center gap-3">
							<div className="min-w-0">
								<Modal.Heading className="text-sm font-semibold">Run workflow</Modal.Heading>
								<p className="truncate text-xs text-muted">{name}</p>
							</div>
							<CloseButton aria-label="Close run dialog" className="ml-auto" />
						</Modal.Header>

						<Modal.Body className="flex flex-col gap-3">
							<div className="flex flex-col gap-1.5">
								<Label>Payload</Label>
								<TextArea
									rows={10}
									className="font-mono text-xs"
									placeholder={EXAMPLE}
									value={payload}
									onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
										setPayload(e.target.value)
									}
								/>
								<p className="text-xs text-muted">
									JSON is sent as JSON; anything else is sent as plain text. Binary goes
									as base64 or hex with a media type saying which — the way an image
									travels through JSON anywhere else.
								</p>
							</div>

							{payload.trim() && !isJson && (
								<Alert status="accent">
									<Alert.Indicator>
										<TbInfoCircle size={16} />
									</Alert.Indicator>
									<Alert.Content>
										<Alert.Description>
											Not valid JSON — this will be sent as plain text.
										</Alert.Description>
									</Alert.Content>
								</Alert>
							)}
						</Modal.Body>

						<Modal.Footer className="flex flex-row items-center gap-2">
							<span className="text-xs text-muted">
								The run is queued and happens on a worker.
							</span>
							<div className="ml-auto flex items-center gap-2">
								<Button variant="ghost" onPress={() => onOpenChange(false)}>
									Cancel
								</Button>
								<Button variant="primary" isPending={run.isPending} onPress={start}>
									<TbPlayerPlay size={16} /> Run
								</Button>
							</div>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
