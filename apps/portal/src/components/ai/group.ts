import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import type { HarnessConversation } from "./types";

dayjs.extend(utc);

export type ConversationGroup = { key: string; label: string; items: HarnessConversation[] };

function dayLabel(date: string | Date): string {
	// Server timestamps are UTC — compare/format in the viewer's local zone.
	const d = dayjs.utc(date).local();
	if (d.isSame(dayjs(), "day")) return "Today";
	if (d.isSame(dayjs().subtract(1, "day"), "day")) return "Yesterday";
	return d.format("DD-MM-YYYY");
}

/**
 * Splits conversations into a pinned section (unless viewing archived) plus
 * date buckets (Today / Yesterday / DD-MM-YYYY) in the list's existing order.
 */
export function groupConversations(
	items: HarnessConversation[],
	{ separatePinned }: { separatePinned: boolean },
): ConversationGroup[] {
	const groups: ConversationGroup[] = [];

	const pinned = separatePinned ? items.filter((c) => c.pinned) : [];
	if (pinned.length > 0) groups.push({ key: "pinned", label: "Pinned", items: pinned });

	const rest = separatePinned ? items.filter((c) => !c.pinned) : items;
	const byDay = new Map<string, HarnessConversation[]>();
	for (const c of rest) {
		const label = dayLabel(c.updatedAt);
		const bucket = byDay.get(label);
		if (bucket) bucket.push(c);
		else byDay.set(label, [c]);
	}
	for (const [label, bucketItems] of byDay) {
		groups.push({ key: label, label, items: bucketItems });
	}

	return groups;
}
