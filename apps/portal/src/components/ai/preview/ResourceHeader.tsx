import { TbPlus } from "react-icons/tb";
import { AgentRef, REF_ICONS } from "../AgentRef";
import type { RefType } from "../agentRefs";

const BADGE = {
	new: "border-success/50 bg-success/10 text-success",
	update: "border-warning/50 bg-warning/10 text-warning",
	saved: "border-border bg-surface text-muted",
	delete: "border-danger/50 bg-danger/10 text-danger",
} as const;

/** Type icon, name, a badge for what happens to it, and the link that opens it in a new tab. */
export function ResourceHeader({
	type,
	name,
	id,
	badge,
	detail,
}: {
	type: RefType;
	name: string;
	id?: string;
	badge: keyof typeof BADGE;
	/** Method and path, a schedule…: what identifies it at a glance. */
	detail?: string;
}) {
	const Icon = REF_ICONS[type];
	return (
		<header className="flex flex-wrap items-center gap-2 text-sm">
			<Icon size={16} className="shrink-0 text-muted" />
			<span className="font-medium text-foreground">{name || type.replace("_", " ")}</span>
			{detail && <code className="rounded bg-surface-secondary px-1.5 text-xs">{detail}</code>}
			<span className={`rounded-full border px-2 text-xs ${BADGE[badge]}`}>
				{badge === "new" && <TbPlus size={10} className="mr-0.5 inline" />}
				{badge === "new" ? "New" : badge[0].toUpperCase() + badge.slice(1)}
			</span>
			{id && badge !== "delete" && (
				<span className="ml-auto">
					<AgentRef type={type} id={id}>
						Open
					</AgentRef>
				</span>
			)}
		</header>
	);
}
