import { MarkdownViewer } from "./MarkdownViewer";
import { HarnessUsageSummary, type HarnessUsage } from "./HarnessUsageSummary";

export function AiMessage({ response, status, usage }: { response?: string | null; status?: string; usage?: HarnessUsage | null }) {
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
					{isCompleted && <HarnessUsageSummary usage={usage} />}
				</div>
			)}
		</div>
	);
}
