import { useState, useEffect, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { TbEdit } from "react-icons/tb";
import { PromptEditor } from "./PromptEditor";
import { useAiModels } from "./useAiModels";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { useIsRunning, useConversationRun, useAiHarnessStore } from "@/store/aiHarness";
import { UserMessage } from "./UserMessage";
import { AiMessage } from "./AiMessage";
import { useScrollToBottom } from "./useScrollToBottom";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { ChatTitleEditor } from "./ChatTitleEditor";
import { AgentTaskStatus } from "./AgentTaskStatus";
import { HarnessStatusAccordion } from "./HarnessStatusAccordion";
import { ArtifactsSidebar } from "./ArtifactsSidebar";
import type { HarnessConversation } from "./types";
import { PlanReviewModal } from "./PlanReviewModal";
import type { ApplyMode } from "./ApplyModeSelect";
import { Button } from "@fluxify/components";
import { TbListSearch } from "react-icons/tb";

export function ConversationPage() {
	const { projectId, conversationId } = useParams({
		from: "/_authed/$projectId/ai/$conversationId",
	});
	const [query, setQuery] = useState("");

	const { models, defaultModelId } = useAiModels(projectId);
	const sendMessage = harnessConversationsQuery.sendMessage.mutation(projectId);
	const actionMutation = harnessConversationsQuery.action.mutation(
		projectId,
		conversationId,
	);

	const isRunning = useIsRunning(conversationId);
	const activeRun = useConversationRun(conversationId);
	const queryClient = useQueryClient();
	const prevIsRunning = useRef(isRunning);
	const bottomRef = useRef<HTMLDivElement>(null);
	const [optimisticQuery, setOptimisticQuery] = useState<string | null>(null);
	const [isPlanReviewModalOpen, setIsPlanReviewModalOpen] = useState(false);

	// Check active conversation from sidebar cache reactively
	const [activeConversation, setActiveConversation] = useState<HarnessConversation | null>(null);
	const isArchived = activeConversation?.archived ?? false;

	// Once a live run exists, its socket-driven runStatus is authoritative — the
	// REST `activeConversation.status` is only a fallback for before any socket
	// event has arrived (it has no live-update path, so it can't be trusted once
	// a run is already streaming: it'd freeze the review UI open forever after
	// the run resumes).
	const isTransitioning = !!optimisticQuery || actionMutation.isPending;

	const isPausedForHitl = !isTransitioning && (
		activeRun?.runStatus === "awaiting_hitl" || 
		(activeRun?.runStatus as string) === "paused_hitl" || 
		(!activeRun && activeConversation?.status === "paused_hitl")
	);

	const isPlanReviewMode = isPausedForHitl;

	const { data: messagesData, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = harnessConversationsQuery.messages.useInfiniteQuery(
		projectId,
		conversationId,
	);

	const messages = messagesData?.pages.flatMap((p) => p.messages) ?? [];

	const topRef = useRef<HTMLDivElement>(null);
	const { isAtBottom, scrollToBottom } = useScrollToBottom(bottomRef, 250);

	const planText = activeRun?.hitl?.markdownPlan || (isPlanReviewMode && messages.length > 0 ? messages[0].aiResponse : null);

	useEffect(() => {
		const checkConversation = () => {
			const queriesData = queryClient.getQueriesData<any>({
				queryKey: ["harness-conversations", projectId, "list-infinite"],
			});
			let foundConv = null;
			outer: for (const [, data] of queriesData) {
				if (!data) continue;
				for (const page of data.pages) {
					const found = page.data.find((c: any) => c.id === conversationId);
					if (found) {
						foundConv = found;
						break outer;
					}
				}
			}
			setActiveConversation(foundConv);
		};

		checkConversation();
		const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
			if (event.query.queryKey[0] === "harness-conversations") {
				checkConversation();
			}
		});
		return unsubscribe;
	}, [projectId, conversationId, queryClient]);

	// Infinite scroll observer
	useEffect(() => {
		if (!topRef.current || !hasNextPage || isFetchingNextPage) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries[0].isIntersecting) fetchNextPage();
		});
		observer.observe(topRef.current);
		return () => observer.disconnect();
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	// Auto-scroll
	useEffect(() => {
		if (optimisticQuery || isAtBottom) {
			// Use instant scroll for streams to prevent animation buildup/fighting
			scrollToBottom(optimisticQuery ? "smooth" : "auto");
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [messages.length, optimisticQuery, activeRun?.lastTimestamp]);

	// Invalidate messages on run completion
	useEffect(() => {
		if (prevIsRunning.current && !isRunning) {
			queryClient.invalidateQueries({
				queryKey: ["harness-conversations", projectId, conversationId, "messages"],
			});
		}
		prevIsRunning.current = isRunning;
	}, [isRunning, queryClient, projectId, conversationId]);

	// Clear artifacts sidebar when navigating to a different conversation
	useEffect(() => {
		useAiHarnessStore.getState().setSelectedArtifact(null);
	}, [conversationId]);

	const submit = (q: string, model: string, isFallback: boolean) => {
		const reqPayload: {
			query: string;
			integrationId?: string;
			conversationId: string;
			applyMode?: ApplyMode;
		} = {
			query: q,
			conversationId,
			applyMode: useAiHarnessStore.getState().applyMode,
		};
		if (!isFallback && model) {
			reqPayload.integrationId = model;
		}

		useAiHarnessStore.getState().clearRun(conversationId);
		setOptimisticQuery(q);

		sendMessage.mutate(reqPayload, {
			onSuccess: () => {
				setQuery("");
				setOptimisticQuery(null);
			},
			onError: (err) => {
				setOptimisticQuery(null);
				showErrorNotification(err);
			},
		});
	};

	const stop = () => {
		actionMutation.mutate(
			{ action: "user_interrupt" },
			{ onError: (err) => showErrorNotification(err) },
		);
	};

	return (
		<div className="flex h-full w-full overflow-hidden">
			<div className="flex flex-col flex-1 h-full relative min-w-0 transition-all duration-300 ease-in-out">
				<div className="absolute top-1.5 left-1 z-20 pointer-events-auto">
					<ChatTitleEditor projectId={projectId} conversation={activeConversation} />
				</div>

				<div className="flex-1 overflow-y-auto px-4 pb-32 pt-16">
					<div className="mx-auto flex w-full max-w-[65%] flex-col-reverse gap-6">
					<div ref={bottomRef} className="h-0 w-0 shrink-0" />
					
					{optimisticQuery && (
						<div className="flex w-full flex-col gap-4">
							<UserMessage query={optimisticQuery} />
						</div>
					)}
					<AgentTaskStatus conversationId={conversationId} />
					


					{isLoading ? (
						<div className="flex w-full flex-col gap-8 animate-pulse pt-8 opacity-60">
							<div className="flex w-full justify-end">
								<div className="h-12 w-64 rounded-2xl bg-surface-secondary"></div>
							</div>
							<div className="flex w-full flex-col gap-2">
								<div className="h-3 w-24 rounded-full bg-surface-secondary mb-1"></div>
								<div className="h-20 w-full rounded-xl bg-surface-secondary"></div>
							</div>
							<div className="flex w-full justify-end">
								<div className="h-12 w-48 rounded-2xl bg-surface-secondary"></div>
							</div>
						</div>
					) : messages.length === 0 && !optimisticQuery ? (
						isPlanReviewMode && planText ? (
							<div className="flex w-full flex-col gap-4 mt-2">
								<div className="w-full rounded-2xl border border-primary/20 bg-primary/5 p-6 flex flex-col gap-4">
									<div className="flex items-start gap-4">
										<div className="bg-primary/20 p-3 rounded-xl text-primary shrink-0">
											<TbListSearch size={24} />
										</div>
										<div className="flex-1">
											<h3 className="text-lg font-semibold text-foreground">Implementation Plan Ready</h3>
											<p className="text-sm text-muted mt-1 leading-relaxed">
												The AI has proposed an implementation plan. Please review the blocks, provide feedback, or approve it to proceed.
											</p>
										</div>
									</div>
									<Button 
										variant="primary" 
										className="w-full font-medium"
										onPress={() => setIsPlanReviewModalOpen(true)}
									>
										Review Plan
									</Button>
								</div>
							</div>
						) : (
							<div className="text-center pt-8">
								<p className="text-sm text-muted">Conversation</p>
								<p className="font-mono text-xs text-muted">{conversationId}</p>
							</div>
						)
					) : (
						messages.map((msg, idx) => {
							const isLatest = idx === 0;
							const isRunActive = isLatest && activeRun && !activeRun.isTerminal;
							const displayStatus = isRunActive ? activeRun.runStatus : msg.status;
							
							const isHitlMessage = msg.status === "awaiting_hitl" || msg.status.startsWith("hitl_");
							
							const looksLikePlan = msg.aiResponse && (
								isHitlMessage ||
								msg.aiResponse === planText || 
								(msg.aiResponse.includes("Plan:") && msg.aiResponse.includes("Task 1:")) ||
								msg.aiResponse.includes("Implementation Plan")
							);
							
							const isActionablePlan = isPlanReviewMode && isLatest && looksLikePlan;
							const isHistoricalPlan = !isActionablePlan && looksLikePlan;
							
							return (
								<div key={msg.id} className="flex w-full flex-col gap-4">
									{msg.userQuery && <UserMessage query={msg.userQuery} />}
									{isActionablePlan && planText ? (
										<div className="w-full rounded-2xl border border-primary/20 bg-primary/5 p-6 flex flex-col gap-4">
											<div className="flex items-start gap-4">
												<div className="bg-primary/20 p-3 rounded-xl text-primary shrink-0">
													<TbListSearch size={24} />
												</div>
												<div className="flex-1">
													<h3 className="text-lg font-semibold text-foreground">Implementation Plan Ready</h3>
													<p className="text-sm text-muted mt-1 leading-relaxed">
														The AI has proposed an implementation plan. Please review the blocks, provide feedback, or approve it to proceed.
													</p>
												</div>
											</div>
											<Button 
												variant="primary" 
												className="w-full font-medium"
												onPress={() => setIsPlanReviewModalOpen(true)}
											>
												Review Plan
											</Button>
										</div>
									) : isHistoricalPlan ? (
										<div className="flex w-full flex-col gap-2">
											{isRunActive && <HarnessStatusAccordion conversationId={conversationId} />}
											<div className="w-full rounded-2xl border border-border bg-surface-secondary p-4 flex flex-col gap-3 opacity-70">
												<div className="flex items-center gap-4">
													<div className="bg-surface p-2.5 rounded-xl text-foreground shrink-0 border border-border">
														<TbListSearch size={20} />
													</div>
													<div className="flex-1">
														<h3 className="text-base font-medium text-foreground">Implementation Plan</h3>
														<p className="text-xs text-muted mt-0.5">
															{isRunActive ? "Plan is currently being executed." : "Plan was reviewed and approved."}
														</p>
													</div>
												</div>
											</div>
										</div>
									) : (
										<div className="flex w-full flex-col gap-2">
											{isRunActive && <HarnessStatusAccordion conversationId={conversationId} />}
											<AiMessage response={msg.aiResponse} status={isRunActive ? undefined : displayStatus} />
										</div>
									)}
								</div>
							);
						})
					)}

					{isFetchingNextPage && (
						<div className="flex w-full flex-col gap-8 animate-pulse py-8 opacity-60">
							<div className="flex w-full justify-end">
								<div className="h-12 w-64 rounded-2xl bg-surface-secondary"></div>
							</div>
							<div className="flex w-full flex-col gap-2">
								<div className="h-3 w-24 rounded-full bg-surface-secondary mb-1"></div>
								<div className="h-20 w-full rounded-xl bg-surface-secondary"></div>
							</div>
						</div>
					)}
					
					{hasNextPage && <div ref={topRef} className="h-1 w-full" />}
				</div>
			</div>

			<div className="sticky bottom-0 px-4 pb-2 pt-4 bg-background relative">
				<ScrollToBottomButton isVisible={!isAtBottom} onClick={() => scrollToBottom("smooth")} />
				<div className="mx-auto w-full max-w-[65%]">
					{isArchived ? (
						<div className="w-full rounded-2xl border border-border bg-surface p-4 text-center text-sm text-muted">
							This conversation is archived and is read-only.
						</div>
					) : (
						<PromptEditor
							projectId={projectId}
							value={query}
							onChange={setQuery}
							onSubmit={submit}
							isPending={sendMessage.isPending}
							models={models}
							defaultModelId={defaultModelId}
							typewriter={false}
							placeholder="Reply to AI..."
							isRunning={isRunning}
							onStop={stop}
							isDisabled={isPlanReviewMode}
						/>
					)}
				</div>
			</div>
			{isPlanReviewMode && planText && (
				<PlanReviewModal
					isOpen={isPlanReviewModalOpen}
					onOpenChange={setIsPlanReviewModalOpen}
					plan={planText}
					projectId={projectId}
					conversationId={conversationId}
				/>
			)}
			</div>
			
			<ArtifactsSidebar />
		</div>
	);
}
