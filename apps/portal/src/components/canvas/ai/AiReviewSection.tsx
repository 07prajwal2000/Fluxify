import { Button, Spinner } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import {
	TbAlertCircle,
	TbAlertTriangle,
	TbCircleCheck,
	TbInfoCircle,
	TbSparkles,
} from "react-icons/tb";
import { useAgentModel } from "@/components/ai/AgentModel";
import { showErrorNotification } from "@/lib/errorNotifier";
import { agentReviewsQuery } from "@/query/agentReviewsQuery";
import type { ReviewFinding, ReviewKind } from "@/services/agentReviews";
import { useCanEditProject } from "@/store/auth";
import { useCanvasAi } from "./CanvasAiContext";

/** A finding opens its block on the first tab: the AI's findings are not on the Diagnostics tab. */
const FINDING_TAB = "General";

const CATEGORY: Record<ReviewFinding["category"], string> = {
	security: "Security",
	correctness: "Correctness",
	test_coverage: "Test coverage",
	schema: "Schema",
	performance: "Performance",
};

const SEVERITY_ICON = {
	error: <TbAlertCircle className="text-danger" size={14} />,
	warning: <TbAlertTriangle className="text-warning" size={14} />,
	info: <TbInfoCircle className="text-muted" size={14} />,
};

/**
 * What "Ask the agent to fix this" puts in a new chat's prompt. The review id and
 * finding number let the agent mark it with resolve_review_finding when it is done.
 */
export function fixPrompt(
	kind: ReviewKind,
	id: string,
	f: ReviewFinding,
	reviewId: string,
	index: number,
) {
	const where = f.blockKeys.length ? ` in ${f.blockKeys.join(", ")}` : "";
	return [
		`An AI review of the ${kind} ${id} found this ${f.severity}${where}:`,
		f.message,
		f.suggestedFix ? `Suggested fix: ${f.suggestedFix}` : "",
		"Check whether it is right, and fix it if it is.",
		`When you are done, call resolve_review_finding with reviewId ${reviewId} and finding ${index}.`,
	]
		.filter(Boolean)
		.join("\n");
}

type Props = { onSelectBlock: (blockId: string, tab?: string) => void };

/**
 * The AI review in the diagnostics panel (#754), for routes and workflows.
 * Suggestions only: its findings stay in this list and never mark the canvas.
 */
export function AiReviewSection({ onSelectBlock }: Props) {
	const ai = useCanvasAi();
	if (!ai?.review) return null;
	return (
		<AiReview
			projectId={ai.projectId}
			kind={ai.review.kind}
			id={ai.review.id}
			openChat={ai.chat.open}
			showChat={ai.chat.show}
			onSelectBlock={onSelectBlock}
		/>
	);
}

function AiReview({
	projectId,
	kind,
	id,
	openChat,
	showChat,
	onSelectBlock,
}: Props & {
	projectId: string;
	kind: ReviewKind;
	id: string;
	openChat: (text: string) => void;
	showChat: (conversationId: string) => void;
}) {
	const canEdit = useCanEditProject(projectId);
	const { data: review, isLoading } = agentReviewsQuery.latest.useQuery(projectId, kind, id);
	const running = review?.status === "running";
	return (
		<section
			aria-label="AI review"
			className="flex flex-col gap-2 rounded-md border border-border bg-surface-secondary/20 p-2.5 text-xs"
		>
			<div className="flex items-center gap-2">
				<TbSparkles className="text-accent" size={14} />
				<span className="font-medium text-foreground">AI review</span>
				<div className="ml-auto">
					{canEdit && (
						<ReviewAction
							projectId={projectId}
							kind={kind}
							id={id}
							running={running}
							again={!!review}
						/>
					)}
				</div>
			</div>

			{isLoading ? (
				<Spinner size="sm" />
			) : !review ? (
				<p className="text-muted">
					AI reads this {kind} and suggests fixes for security, correctness, test coverage, schema
					and performance problems. It only reads: it never changes the canvas.
				</p>
			) : running ? (
				<p className="flex items-center gap-2 text-muted">
					<Spinner size="sm" />
					Reviewing. You can keep editing or leave this page.
				</p>
			) : review.status === "failed" ? (
				<p className="text-danger">The review failed: {review.error}</p>
			) : review.status === "cancelled" ? (
				<p className="text-muted">The review was cancelled.</p>
			) : (
				<>
					{review.stale && (
						<p className="rounded bg-warning/10 px-2 py-1 text-warning">
							Reviewed an older version: the {kind} was saved since. Run it again for a fresh
							review.
						</p>
					)}
					{review.summary && <p className="leading-snug text-foreground">{review.summary}</p>}
					{review.findings?.length ? (
						<ul className="flex flex-col gap-1.5 border-t border-border/50 pt-2">
							{review.findings.map((f, i) => (
								<Finding
									// biome-ignore lint/suspicious/noArrayIndexKey: findings have no id and never reorder
									key={i}
									finding={f}
									kind={kind}
									onSelectBlock={onSelectBlock}
									onAskFix={
										canEdit ? () => openChat(fixPrompt(kind, id, f, review.id, i)) : undefined
									}
									onShowChat={showChat}
								/>
							))}
						</ul>
					) : (
						<p className="text-muted">No problems found.</p>
					)}
				</>
			)}
		</section>
	);
}

/** Start, run again, or cancel; with no AI connection, where to set one. */
function ReviewAction({
	projectId,
	kind,
	id,
	running,
	again,
}: {
	projectId: string;
	kind: ReviewKind;
	id: string;
	running: boolean;
	again: boolean;
}) {
	const { isLoading, missing } = useAgentModel(projectId);
	const start = agentReviewsQuery.start.mutation(projectId, kind, id);
	const stop = agentReviewsQuery.stop.mutation(projectId, kind, id);
	if (isLoading) return null;
	if (missing)
		return (
			<Link
				to="/$projectId/settings"
				params={{ projectId }}
				search={{ tab: "ai-connections" }}
				className="text-accent hover:underline"
			>
				Set an AI connection to review
			</Link>
		);
	if (running)
		return (
			<Button
				size="sm"
				variant="secondary"
				className="h-7 px-2 text-xs"
				isPending={stop.isPending}
				onPress={() => stop.mutate(undefined, { onError: (e) => showErrorNotification(e) })}
			>
				Cancel
			</Button>
		);
	return (
		<Button
			size="sm"
			variant="secondary"
			className="h-7 px-2 text-xs"
			isPending={start.isPending}
			onPress={() => start.mutate(undefined, { onError: (e) => showErrorNotification(e) })}
		>
			{again ? "Run again" : "Review with AI"}
		</Button>
	);
}

function Finding({
	finding: f,
	kind,
	onSelectBlock,
	onAskFix,
	onShowChat,
}: {
	finding: ReviewFinding;
	kind: ReviewKind;
	onSelectBlock: Props["onSelectBlock"];
	onAskFix?: () => void;
	onShowChat: (conversationId: string) => void;
}) {
	const blockId = f.blockIds[0];
	const done = f.resolution;
	const fixed = done?.status === "fixed";
	return (
		<li
			className={`flex flex-col gap-1 rounded p-1.5 transition-colors ${fixed ? "border border-success/40 bg-success/10" : "hover:bg-surface-secondary"}`}
		>
			<button
				type="button"
				disabled={!blockId}
				onClick={() => blockId && onSelectBlock(blockId, FINDING_TAB)}
				className="flex w-full items-start gap-2 text-left disabled:cursor-default"
			>
				<span className="mt-0.5 shrink-0" role="img" aria-label={fixed ? "fixed" : f.severity}>
					{fixed ? <TbCircleCheck className="text-success" size={14} /> : SEVERITY_ICON[f.severity]}
				</span>
				<span className="flex min-w-0 flex-1 flex-col">
					<span className="leading-snug text-foreground">{f.message}</span>
					<span className="text-[10px] text-muted">
						{CATEGORY[f.category]} · {f.blockKeys.join(", ") || `whole ${kind}`}
					</span>
				</span>
			</button>
			{f.suggestedFix && <p className="pl-6 leading-snug text-muted">Fix: {f.suggestedFix}</p>}
			{done ? (
				<p className={`pl-6 leading-snug ${fixed ? "text-success" : "text-muted"}`}>
					{fixed ? "Fixed by the agent" : "The agent found this is not an issue"}
					{done.note && `: ${done.note}`}{" "}
					<button
						type="button"
						className="text-accent hover:underline"
						onClick={() => onShowChat(done.conversationId)}
					>
						Open chat
					</button>
				</p>
			) : (
				onAskFix && (
					<Button
						size="sm"
						variant="ghost"
						className="ml-4 h-6 self-start px-2 text-xs"
						onPress={onAskFix}
					>
						Ask the agent to fix this
					</Button>
				)
			)}
		</li>
	);
}
