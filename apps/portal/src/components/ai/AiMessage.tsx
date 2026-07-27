import { MarkdownViewer } from "./MarkdownViewer";

export function AiMessage({ response, status }: { response?: string | null; status?: string }) {
	const isCompleted = !status || status.toLowerCase() === "completed";

	if (!response && !status) return null;

	return (
		<div className="flex w-full flex-col gap-2">
			{!isCompleted && (
				<div className="text-xs font-semibold uppercase tracking-wider text-muted px-2">
					{status!.replace(/_/g, " ")}
				</div>
			)}
			{response && (
				<div className="w-full">
					<MarkdownViewer content={response} />
				</div>
			)}
		</div>
	);
}
