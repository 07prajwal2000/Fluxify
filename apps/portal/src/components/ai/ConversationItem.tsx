import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Key } from "@fluxify/components";
import { Button, Dropdown, Label } from "@fluxify/components";
import {
	TbDots,
	TbPin,
	TbPinnedOff,
	TbArchive,
	TbArchiveOff,
	TbTrash,
	TbEdit,
} from "react-icons/tb";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { getTimeAgo } from "@/lib/datetime";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatusDot } from "./StatusDot";
import { RenameConversationModal } from "./RenameConversationModal";
import type { HarnessConversation } from "./types";
import { useConversationRun } from "@/store/aiHarness";

type Props = {
	projectId: string;
	conversation: HarnessConversation;
	active: boolean;
	onOpen: (id: string) => void;
};

export function ConversationItem({
	projectId,
	conversation: c,
	active,
	onOpen,
}: Props) {
	const navigate = useNavigate();
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [renameOpen, setRenameOpen] = useState(false);
	const action = harnessConversationsQuery.action.mutation(projectId, c.id);
	const remove = harnessConversationsQuery.remove.mutation(projectId);
	const activeRun = useConversationRun(c.id);

	const redirectHome = () => {
		navigate({
			to: "/$projectId/ai",
			params: { projectId },
			viewTransition: true,
		});
	};

	const onAction = async (key: Key) => {
		if (key === "delete") return setConfirmOpen(true);
		if (key === "rename") return setRenameOpen(true);
		
		let act: "pin" | "unpin" | "archive" | "unarchive" | undefined;
		if (key === "pin_toggle") act = c.pinned ? "unpin" : "pin";
		else if (key === "archive_toggle") act = c.archived ? "unarchive" : "archive";

		if (act) {
			try {
				if (act === "archive" && active) redirectHome();
				await action.mutateAsync({ action: act });
			} catch (err: any) {
				showErrorNotification(err.message);
			}
		}
	};

	return (
		<div
			className={`group/item relative rounded-lg transition-colors hover:bg-surface ${
				active ? "bg-surface" : ""
			}`}
		>
			<button
				type="button"
				onClick={() => onOpen(c.id)}
				className="flex w-full flex-col gap-1 px-2.5 py-2 pr-9 text-left"
			>
				<span
					className={`flex items-center gap-1.5 text-sm ${
						c.pinned ? "font-medium text-accent" : "text-foreground"
					}`}
				>
					{c.pinned && <TbPin size={13} className="shrink-0" />}
					<span className="truncate">{c.title ?? "Untitled session"}</span>
				</span>
				{c.userQuery && (
					<span className="truncate font-mono text-xs text-muted">
						→ {c.userQuery}
					</span>
				)}
				<span className="flex items-center gap-2 text-[11px] text-muted">
					{getTimeAgo(c.updatedAt)}
					<StatusDot status={activeRun?.runStatus || c.status} />
				</span>
			</button>

			<div className="absolute top-1.5 right-1 opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
				<Dropdown>
					<Dropdown.Trigger>
						<Button
							isIconOnly
							size="sm"
							variant="ghost"
							aria-label="Conversation options"
						>
							<TbDots size={16} />
						</Button>
					</Dropdown.Trigger>
					<Dropdown.Popover>
						<Dropdown.Menu onAction={onAction}>
							<Dropdown.Item
								id="pin_toggle"
								textValue={c.pinned ? "Unpin" : "Pin"}
							>
								{c.pinned ? <TbPinnedOff size={16} /> : <TbPin size={16} />}
								<Label>{c.pinned ? "Unpin" : "Pin"}</Label>
							</Dropdown.Item>
							<Dropdown.Item
								id="archive_toggle"
								textValue={c.archived ? "Unarchive" : "Archive"}
							>
								{c.archived ? (
									<TbArchiveOff size={16} />
								) : (
									<TbArchive size={16} />
								)}
								<Label>{c.archived ? "Unarchive" : "Archive"}</Label>
							</Dropdown.Item>
							<Dropdown.Item id="rename" textValue="Rename">
								<TbEdit size={16} />
								<Label>Rename</Label>
							</Dropdown.Item>
							<Dropdown.Item
								id="delete"
								variant="danger"
								textValue="Delete"
								className="text-danger hover:bg-danger/10 focus:bg-danger/10 focus:text-danger"
							>
								<TbTrash size={16} className="text-danger" />
								<Label className="text-danger">Delete</Label>
							</Dropdown.Item>
						</Dropdown.Menu>
					</Dropdown.Popover>
				</Dropdown>
			</div>

			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title="Delete conversation?"
				confirmText="Delete"
				danger
				pending={remove.isPending}
				onConfirm={() => {
					if (active) redirectHome();
					remove.mutate(c.id, {
						onSettled: () => setConfirmOpen(false),
						onError: (err) => showErrorNotification(err),
					});
				}}
			>
				This permanently removes “{c.title ?? "this conversation"}”.
			</ConfirmDialog>

			<RenameConversationModal
				open={renameOpen}
				onOpenChange={setRenameOpen}
				projectId={projectId}
				conversationId={c.id}
				initialTitle={c.title || "Untitled session"}
			/>
		</div>
	);
}
