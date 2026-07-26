import { useState } from "react";
import type { Key } from "@fluxify/components";
import { Button, Dropdown, Label } from "@fluxify/components";
import { TbDots, TbPin, TbPinnedOff, TbArchive, TbArchiveOff, TbTrash } from "react-icons/tb";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { getTimeAgo } from "@/lib/datetime";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatusDot } from "./StatusDot";
import type { HarnessConversation } from "./types";

type Props = {
	projectId: string;
	conversation: HarnessConversation;
	active: boolean;
	onOpen: (id: string) => void;
};

export function ConversationItem({ projectId, conversation: c, active, onOpen }: Props) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const action = harnessConversationsQuery.action.mutation(projectId, c.id);
	const remove = harnessConversationsQuery.remove.mutation(projectId);

	const onAction = (key: Key) => {
		if (key === "delete") return setConfirmOpen(true);
		const map = { pin: "pin", unpin: "unpin", archive: "archive", unarchive: "unarchive" } as const;
		const act = map[key as keyof typeof map];
		if (act) action.mutate({ action: act }, { onError: (err) => showErrorNotification(err) });
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
					<span className="truncate font-mono text-xs text-muted">→ {c.userQuery}</span>
				)}
				<span className="flex items-center gap-2 text-[11px] text-muted">
					{getTimeAgo(c.updatedAt)}
					<StatusDot status={c.status} />
				</span>
			</button>

			<div className="absolute top-1.5 right-1 opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
				<Dropdown>
					<Dropdown.Trigger>
						<Button isIconOnly size="sm" variant="ghost" aria-label="Conversation options">
							<TbDots size={16} />
						</Button>
					</Dropdown.Trigger>
					<Dropdown.Popover>
						<Dropdown.Menu onAction={onAction}>
							<Dropdown.Item id={c.pinned ? "unpin" : "pin"} textValue={c.pinned ? "Unpin" : "Pin"}>
								{c.pinned ? <TbPinnedOff size={16} /> : <TbPin size={16} />}
								<Label>{c.pinned ? "Unpin" : "Pin"}</Label>
							</Dropdown.Item>
							<Dropdown.Item
								id={c.archived ? "unarchive" : "archive"}
								textValue={c.archived ? "Unarchive" : "Archive"}
							>
								{c.archived ? <TbArchiveOff size={16} /> : <TbArchive size={16} />}
								<Label>{c.archived ? "Unarchive" : "Archive"}</Label>
							</Dropdown.Item>
							<Dropdown.Item id="delete" variant="danger" textValue="Delete">
								<TbTrash size={16} />
								<Label>Delete</Label>
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
				onConfirm={() =>
					remove.mutate(c.id, {
						onSuccess: () => setConfirmOpen(false),
						onError: (err) => showErrorNotification(err),
					})
				}
			>
				This permanently removes “{c.title ?? "this conversation"}”.
			</ConfirmDialog>
		</div>
	);
}
