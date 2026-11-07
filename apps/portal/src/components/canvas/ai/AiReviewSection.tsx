import { Button, Spinner } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
	TbAlertCircle,
	TbAlertTriangle,
	TbChevronDown,
	TbChevronRight,
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

/** Whether the AI review is expanded, kept per browser (#1081). */
const OPEN_KEY = "fx-ai-review-open";
const readOpen = () => {
	try {
		return localStorage.getItem(OPEN_KEY) !== "false";
	} catch {
		return true;
	}
};

/** A finding opens its block on the first tab: the AI's findings are not on the Diagnostics tab. */
const FINDING_TAB = "General";

const CATEGORY: Record<ReviewFinding["category"], string> = {
	security: "Security",
	error_handling: "Error handling",
	correctness: "Correctness",
	data_integrity: "Data integrity",
	test_coverage: "Test coverage",
	schema: "Schema",
	performance: "Performance",
};

const SEVERITY_ICON = {
	error: <TbAlertCircle className="text-danger" size={14} />,
	warning: <TbAlertTriangle className="text-warning" size={14} />,
	info: <TbInfoCircle className="text-muted" size={14} />,
};
const SEVERITY_LABEL = { error: "Error", warning: "Warning", info: "Info" };
const PILL = {
	error: "bg-danger/10 text-danger",
	warning: "bg-warning/10 text-warning",
	info: "bg-surface-secondary text-muted",
};
/** The card's left edge carries the severity, so a long list scans at a glance. */
const EDGE = { error: "border-l-danger", warning: "border-l-warning", info: "border-l-border" };

/**
 * What "Ask the agent to fix this" puts in a new chat's prompt. The review id and
 * finding number (from 1, as the report counts) let the agent mark it with
 * resolve_review_finding when it is done.
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
		`When you are done, call resolve_review_finding with reviewId ${reviewId} and finding ${index + 1}.`,
	]
		.filter(Boolean)
		.join("\n");
}

/**
 * What "Fix all" puts in a new chat's prompt (#1081): one numbered item per open
 * finding. Each keeps its report number, so the user can delete items from the
 * draft and the agent still marks the right ones.
 */
export function fixAllPrompt(
	kind: ReviewKind,
	id: string,
	findings: { finding: ReviewFinding; index: number }[],
	reviewId: string,
) {
	const items = findings.map(({ finding: f, index }) => {
		const where = f.blockKeys.length ? ` in ${f.blockKeys.join(", ")}` : "";
		const fix = f.suggestedFix ? `\n   Suggested fix: ${f.suggestedFix}` : "";
		return `${index + 1}. [${f.severity}${where}] ${f.message}${fix}`;
	});
	return [
		`An AI review of the ${kind} ${id} found these problems. Work through each one still in this list: check whether it is right, and fix it if it is.`,
		items.join("\n\n"),
		`When you are done, call resolve_review_finding once with reviewId ${reviewId} and an entry for each finding still listed above, by its number.`,
	].join("\n\n");
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
	const [open, setOpen] = useState(readOpen);
	const toggle = () => {
		setOpen(!open);
		try {
			localStorage.setItem(OPEN_KEY, String(!open));
		} catch {}
	};
	const unresolved = review?.findings?.filter((f) => f.resolution?.status !== "fixed") ?? [];
	const worst = (["error", "warning", "info"] as const).find((s) =>
		unresolved.some((f) => f.severity === s),
	);
	// what Fix all sends: every finding the agent has not marked yet, with its report number
	const toFix =
		review?.status === "completed"
			? (review.findings ?? [])
					.map((finding, index) => ({ finding, index }))
					.filter(({ finding }) => !finding.resolution)
			: [];
	return (
		<section
			aria-label="AI review"
			className="flex flex-col gap-2 rounded-md border border-border bg-surface-secondary/20 p-2.5 text-xs"
		>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={toggle}
					aria-expanded={open}
					aria-label={open ? "Collapse AI review" : "Expand AI review"}
					className="flex min-w-0 flex-1 items-center gap-2 text-left"
				>
					{open ? (
						<TbChevronDown className="text-muted" size={14} />
					) : (
						<TbChevronRight className="text-muted" size={14} />
					)}
					<TbSparkles className="text-accent" size={14} />
					<span className="font-medium text-foreground">AI review</span>
					{!open && worst && (
						<span className="flex items-center gap-1 text-muted">
							{SEVERITY_ICON[worst]}
							{unresolved.length}
						</span>
					)}
				</button>
				<div className="ml-auto flex items-center gap-1.5">
					{canEdit && toFix.length > 1 && review && (
						<Button
							size="sm"
							variant="primary"
							className="h-7 px-2 text-xs"
							onPress={() => openChat(fixAllPrompt(kind, id, toFix, review.id))}
						>
							Fix all ({toFix.length})
						</Button>
					)}
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

			{!open ? null : isLoading ? (
				<Spinner size="sm" />
			) : !review ? (
				<p className="text-muted">
					AI reads this {kind} and suggests fixes for security, error handling, correctness, data
					integrity, schema, performance and test coverage problems. It only reads: it never changes
					the canvas.
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
					{review.summary && <Summary text={review.summary} />}
					{review.findings?.length ? (
						<ul className="flex flex-col gap-2.5">
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

/** The report's summary, cut to three lines until asked for more. */
function Summary({ text }: { text: string }) {
	const [more, setMore] = useState(false);
	return (
		<div className="flex flex-col gap-1 rounded-md bg-surface-secondary/40 px-3 py-2.5">
			<p className={`text-[13px] leading-relaxed text-foreground/90 ${more ? "" : "line-clamp-3"}`}>
				{text}
			</p>
			{text.length > 180 && (
				<button
					type="button"
					onClick={() => setMore(!more)}
					className="self-start text-[11px] font-medium text-accent hover:underline"
				>
					{more ? "Show less" : "Show more"}
				</button>
			)}
		</div>
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
			className={`flex flex-col gap-2.5 rounded-md border border-l-2 p-3 ${fixed ? "border-success/40 border-l-success bg-success/10" : `border-border bg-background ${EDGE[f.severity]}`}`}
		>
			<div className="flex flex-wrap items-center gap-1.5">
				<span
					className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-[11px] ${fixed ? "bg-success/15 text-success" : PILL[f.severity]}`}
					role="img"
					aria-label={fixed ? "fixed" : f.severity}
				>
					{fixed ? <TbCircleCheck size={12} /> : SEVERITY_ICON[f.severity]}
					{fixed ? "Fixed" : SEVERITY_LABEL[f.severity]}
				</span>
				<span className="rounded bg-surface-secondary px-1.5 py-0.5 text-[11px] text-muted">
					{CATEGORY[f.category]}
				</span>
			</div>

			<button
				type="button"
				disabled={!blockId}
				onClick={() => blockId && onSelectBlock(blockId, FINDING_TAB)}
				className={`text-left text-[13px] leading-relaxed disabled:cursor-default ${fixed ? "text-muted" : "text-foreground enabled:hover:text-accent"}`}
			>
				{f.message}
			</button>

			<div className="flex flex-wrap items-center gap-1">
				{f.blockKeys.length ? (
					f.blockKeys.map((k, i) => (
						<button
							key={k}
							type="button"
							onClick={() => onSelectBlock(f.blockIds[i], FINDING_TAB)}
							className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-accent hover:text-accent"
						>
							{k}
						</button>
					))
				) : (
					<span className="text-[11px] text-muted">Whole {kind}</span>
				)}
			</div>

			{f.suggestedFix && !fixed && (
				<details className="group rounded-md bg-surface-secondary/60">
					<summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 font-medium text-[11px] text-muted hover:text-foreground">
						<TbChevronRight size={12} className="transition-transform group-open:rotate-90" />
						Suggested fix
					</summary>
					<p className="px-2.5 pb-2.5 pl-[26px] leading-relaxed text-foreground/80">
						{f.suggestedFix}
					</p>
				</details>
			)}

			{done ? (
				<div
					className={`flex flex-col gap-1 rounded-md px-2.5 py-2 ${fixed ? "bg-success/10 text-success" : "bg-surface-secondary/60 text-muted"}`}
				>
					<p className="leading-relaxed">
						{fixed ? "Fixed by the agent" : "The agent found this is not an issue"}
						{done.note && `: ${done.note}`}
					</p>
					<button
						type="button"
						className="self-start font-medium text-accent hover:underline"
						onClick={() => onShowChat(done.conversationId)}
					>
						Open chat
					</button>
				</div>
			) : (
				onAskFix && (
					<Button
						size="sm"
						variant="secondary"
						className="h-7 self-start px-2.5 text-xs"
						onPress={onAskFix}
					>
						<TbSparkles size={13} className="mr-1 text-accent" />
						Ask the agent to fix this
					</Button>
				)
			)}
		</li>
	);
}
