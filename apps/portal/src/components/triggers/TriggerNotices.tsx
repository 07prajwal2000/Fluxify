import type { ReactNode } from "react";
import { Alert, toast } from "@fluxify/components";
import { isAxiosError } from "axios";
import { TbAlertTriangle } from "react-icons/tb";

/** Warnings the server returned with a save, or why it refused one. */
export function NoticeList({
	status,
	title,
	items,
}: {
	status: "warning" | "danger";
	title: string;
	items: string[];
}) {
	if (items.length === 0) return null;
	let body: ReactNode = items[0];
	if (items.length > 1)
		body = (
			<ul className="list-disc pl-4">
				{items.map((item) => (
					<li key={item}>{item}</li>
				))}
			</ul>
		);
	return (
		<Alert status={status}>
			<Alert.Indicator>
				<TbAlertTriangle size={16} />
			</Alert.Indicator>
			<Alert.Content>
				<Alert.Title>{title}</Alert.Title>
				<Alert.Description>{body}</Alert.Description>
			</Alert.Content>
		</Alert>
	);
}

/** Why the system switched a trigger off — say, its queue was deleted. */
export function DisabledReason({ reason }: { reason?: string | null }) {
	if (!reason) return null;
	return (
		<p className="line-clamp-2 text-xs text-danger" title={reason}>
			Turned off: {reason}
		</p>
	);
}

/** Warnings from a save that did not need its own screen, like a toggle. */
export function announceWarnings(warnings?: string[]) {
	for (const warning of warnings ?? []) toast.warning(warning);
}

/** The server's own sentence for a refused save, not "Request failed with status 400". */
export function errorMessage(error: unknown) {
	if (isAxiosError(error)) {
		const data = error.response?.data as { message?: string; errors?: { message: string }[] } | undefined;
		return data?.errors?.map((item) => item.message).join(" ") || data?.message || error.message;
	}
	return error instanceof Error ? error.message : String(error);
}
