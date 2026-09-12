import { TbAlertTriangle } from "react-icons/tb";
import type { OrchestrationStatus } from "@/services/orchestration";

/**
 * The failure that matters most: a trigger group with enabled triggers and
 * nothing healthy serving it.
 *
 * It has to be loud rather than a number on a chart. Triggers consume their
 * source directly, so there is no internal queue anyone can inspect — the
 * external topic or queue simply grows and the product says nothing. A group
 * with no enabled trigger stays silent: it has no work to be late with.
 */
export function GroupAlarms({ alarms }: { alarms: OrchestrationStatus["alarms"] }) {
	if (alarms.length === 0) return null;

	return (
		<section className="flex flex-col gap-2 rounded-xl border border-danger/40 bg-danger/10 p-4">
			<div className="flex items-center gap-2">
				<TbAlertTriangle className="h-5 w-5 text-danger" />
				<h3 className="text-sm font-bold text-foreground">
					{alarms.length === 1
						? "A trigger group has work and nothing to run it"
						: `${alarms.length} trigger groups have work and nothing to run them`}
				</h3>
			</div>
			<ul className="flex flex-col gap-1 pl-7">
				{alarms.map((alarm) => (
					<li key={`${alarm.projectId}:${alarm.groupId}`} className="text-xs text-foreground">
						<span className="font-medium">{alarm.groupName}</span>
						{" — "}
						{alarm.activeTriggers} enabled trigger(s),{" "}
						{alarm.claimedNodes === 0
							? "no node claims this group"
							: `${alarm.claimedNodes} node(s) claim it but none are serving`}
						.
					</li>
				))}
			</ul>
			<p className="pl-7 text-xs text-muted">
				Events are piling up at the source and nothing is reading them. Claim a node for these
				groups, or wait for an unhealthy one to come back.
			</p>
		</section>
	);
}
