import { TbTrash, TbUser } from "react-icons/tb";
import type { ToolPart } from "../agentMessages";
import { rec, str } from "./data";
import { Notice } from "./Notice";

/** Previews project member operations: add_member, update_member_role, remove_member. */
export function MemberPreview({ tool, asking }: { tool: ToolPart; asking: boolean }) {
	const input = rec(tool.input);
	const out = rec(tool.output);
	const user = str(input.user) || str(input.userId);
	const role = str(out.role) || str(input.role) || "member";

	if (tool.name === "remove_member") {
		const done = !asking && out.removed !== undefined;
		return (
			<section
				aria-label="Remove member"
				className="flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs"
			>
				<header className="flex items-center gap-2">
					<TbTrash size={16} className="shrink-0 text-danger" />
					<span className="font-medium text-danger">{done ? "Removed" : "Remove"} member</span>
					<span className="font-mono text-foreground">{user}</span>
				</header>
				{!done && <p className="text-danger">This cannot be undone.</p>}
			</section>
		);
	}

	const isUpdate = tool.name === "update_member_role";
	return (
		<div className="flex flex-col gap-2">
			<header className="flex items-center gap-2 text-sm">
				<TbUser size={16} className="shrink-0 text-muted" />
				<span className="font-medium text-foreground">{user}</span>
				<span className="rounded-full border border-border bg-surface px-2 text-xs capitalize text-muted">
					{role}
				</span>
			</header>
			{asking && (
				<Notice tone="warning">
					{isUpdate
						? `This action will change the role of ${user} to ${role}.`
						: `This action will add ${user} to the project with role ${role}.`}
				</Notice>
			)}
		</div>
	);
}
