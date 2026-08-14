import { useState, useEffect, useRef } from "react";
import { Modal, Button, CloseButton, DeleteIconButton, Popover, PopoverTrigger, PopoverContent } from "@fluxify/components";
import { TbMessageCirclePlus, TbCheck, TbX, TbEdit, TbPlus } from "react-icons/tb";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQueryClient } from "@tanstack/react-query";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { MarkdownViewer } from "./MarkdownViewer";
import { useAiHarnessStore } from "@/store/aiHarness";

interface PlanReviewModalProps {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	plan: string;
	projectId: string;
	conversationId: string;
}

const HoverableBlock = ({
	children,
	blockId,
	existingReview,
	onSaveReview,
	isSelected,
	onClick,
}: {
	children: React.ReactNode;
	blockId: string;
	existingReview?: string;
	onSaveReview: (id: string, text: string) => void;
	isSelected?: boolean;
	onClick?: () => void;
}) => {
	const [hovered, setHovered] = useState(false);
	const [popoverOpened, setPopoverOpened] = useState(false);
	const [reviewText, setReviewText] = useState(existingReview || "");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (popoverOpened && textareaRef.current) {
			const timeout = setTimeout(() => {
				textareaRef.current?.focus();
			}, 50);
			return () => clearTimeout(timeout);
		}
	}, [popoverOpened]);

	const handleSave = () => {
		onSaveReview(blockId, reviewText);
		setPopoverOpened(false);
	};

	const hasReview = !!existingReview;

	return (
		<div
			id={blockId}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			className={`relative px-3 py-1 pr-12 my-1 rounded-lg transition-all duration-200 border-l-2 ${
				isSelected || hasReview
					? "bg-accent/15 border-accent"
					: hovered
						? "bg-surface-secondary border-transparent"
						: "border-transparent"
			}`}
		>
			{children}

			{(hovered || popoverOpened || hasReview) && (
				<div className="absolute top-1 right-2 z-10">
					{/* @ts-expect-error placement is valid */}
					<Popover placement="left-start" isOpen={popoverOpened} onOpenChange={setPopoverOpened}>
						<PopoverTrigger>
							<Button
								isIconOnly
								size="sm"
								variant={hasReview ? "primary" : "secondary"}
								className="rounded-full h-7 w-7 shadow-md"
							>
								{hasReview ? <TbEdit size={14} /> : <TbMessageCirclePlus size={14} />}
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-[320px] rounded-xl border border-border bg-overlay p-4 shadow-xl">
							<div className="flex w-full flex-col gap-3">
								<textarea
									ref={textareaRef}
									placeholder="Add a review..."
									value={reviewText}
									onChange={(e) => setReviewText(e.target.value)}
									className="w-full min-h-[100px] rounded-lg bg-surface p-3 text-sm text-foreground outline-none placeholder:text-muted resize-none border border-border focus:border-accent"
								/>
								<div className="flex justify-between items-center pt-1">
									<button
										className="text-sm text-muted cursor-pointer hover:text-foreground transition-colors bg-transparent border-none outline-none"
										onClick={() => setPopoverOpened(false)}
									>
										Cancel
									</button>
									<Button
										size="sm"
										variant="primary"
										className="h-8 text-xs font-semibold px-4 rounded-md"
										onPress={handleSave}
									>
										{hasReview ? "Save Review" : "Add Review"}
									</Button>
								</div>
							</div>
						</PopoverContent>
					</Popover>
				</div>
			)}
		</div>
	);
};

export function PlanReviewModal({ isOpen, onOpenChange, plan, projectId, conversationId }: PlanReviewModalProps) {
	const [reviews, setReviews] = useState<Record<string, string>>({});
	const [rejectPopoverOpened, setRejectPopoverOpened] = useState(false);
	const [rejectReason, setRejectReason] = useState("");
	const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
	const rejectTextareaRef = useRef<HTMLTextAreaElement>(null);

	const [customPopoverOpened, setCustomPopoverOpened] = useState(false);
	const [customReviewId, setCustomReviewId] = useState<string | null>(null);
	const [customReviewText, setCustomReviewText] = useState("");
	const customTextareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (rejectPopoverOpened && rejectTextareaRef.current) {
			const timeout = setTimeout(() => {
				rejectTextareaRef.current?.focus();
			}, 50);
			return () => clearTimeout(timeout);
		}
	}, [rejectPopoverOpened]);

	useEffect(() => {
		if (customPopoverOpened && customTextareaRef.current) {
			const timeout = setTimeout(() => {
				customTextareaRef.current?.focus();
			}, 50);
			return () => clearTimeout(timeout);
		}
	}, [customPopoverOpened]);

	const actionMutation = harnessConversationsQuery.action.mutation(projectId, conversationId);

	useEffect(() => {
		if (selectedBlockId) {
			const timeout = setTimeout(() => setSelectedBlockId(null), 5000);
			return () => clearTimeout(timeout);
		}
	}, [selectedBlockId]);

	const handleReviewClick = (id: string) => {
		setSelectedBlockId(id);
		if (id.startsWith("custom-")) {
			setCustomReviewId(id);
			setCustomReviewText(reviews[id] || "");
			setCustomPopoverOpened(true);
		} else {
			const element = document.getElementById(id);
			if (element) {
				element.scrollIntoView({ behavior: "smooth", block: "center" });
			}
		}
	};

	const handleSaveReview = (id: string, text: string) => {
		setReviews((prev) => {
			const newReviews = { ...prev };
			if (!text.trim()) delete newReviews[id];
			else newReviews[id] = text;
			return newReviews;
		});
	};

	const hasReviews = Object.keys(reviews).length > 0;

	const blockData = (() => {
		const data: { content: string, lineNumber: number, id: string }[] = [];
		let currentLineNumber = 1;
		const rawBlocks = plan.split(/(\n\n+)/);
		let index = 0;
		for (let i = 0; i < rawBlocks.length; i++) {
			if (i % 2 === 0) {
				if (rawBlocks[i].trim().length > 0) {
					data.push({
						content: rawBlocks[i],
						lineNumber: currentLineNumber,
						id: "block-" + index,
					});
					index++;
				}
				currentLineNumber += (rawBlocks[i].match(/\n/g) || []).length;
			} else {
				currentLineNumber += (rawBlocks[i].match(/\n/g) || []).length;
			}
		}
		return data;
	})();

	const handleAction = (action: "approve" | "reject" | "review") => {
		const payload =
			action === "review"
				? {
						action: "hitl_review" as const,
						hitl_review: {
							reviews: Object.entries(reviews).map(([id, text]) => {
								if (id.startsWith("custom-")) return `(Custom Review): ${text}`;
								const block = blockData.find((b) => b.id === id);
								const lineNum = block ? block.lineNumber : 1;
								return `(Line ${lineNum}): ${text}`;
							}),
						},
					}
				: { action: action === "approve" ? ("hitl_approve" as const) : ("hitl_reject" as const) };

		actionMutation.mutate(payload, {
			onSuccess: () => {
				useAiHarnessStore.getState().optimisticResume(conversationId);
				onOpenChange(false);
				setReviews({});
			},
			onError: (err) => {
				console.error("Action failed:", err);
			}
		});
	};


	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="lg">
					<Modal.Dialog className="max-w-6xl w-full">
						<Modal.Header className="border-b border-border px-6 py-3 flex flex-row items-center justify-between">
							<h3 className="text-lg font-semibold">Review Proposed Plan</h3>
							<CloseButton />
						</Modal.Header>
						<Modal.Body className="p-0 flex flex-row overflow-hidden" style={{ height: "calc(90vh - 140px)" }}>
							{/* Left Panel: Markdown Content (60%) */}
							<div className="flex-1 overflow-y-auto p-6 border-r border-border bg-background">
								<div className="mx-auto max-w-3xl">
									{blockData.map((block) => {
										return (
											<HoverableBlock
												key={block.id}
												blockId={block.id}
												existingReview={reviews[block.id]}
												onSaveReview={handleSaveReview}
												isSelected={selectedBlockId === block.id}
												onClick={() => setSelectedBlockId(block.id)}
											>
												<MarkdownViewer content={block.content} />
											</HoverableBlock>
										);
									})}
								</div>
							</div>

							{/* Right Panel: Reviews (40%) */}
							<div className="w-2/5 flex flex-col bg-surface overflow-hidden">
								<div className="p-6 pb-4 border-b border-border shrink-0 flex items-center justify-between">
									<h4 className="text-lg font-semibold">Your Reviews</h4>
									{/* @ts-expect-error placement is valid */}
									<Popover placement="bottom-end" isOpen={customPopoverOpened} onOpenChange={(open) => {
										if (!open) setCustomPopoverOpened(false);
									}}>
										<PopoverTrigger>
											<Button
												size="sm"
												variant="ghost"
												className="h-7 text-xs border border-accent text-accent hover:bg-accent/10 px-3 rounded-md transition-colors"
												onPress={() => {
													setCustomReviewId(null);
													setCustomReviewText("");
													setCustomPopoverOpened(true);
												}}
											>
												<TbPlus size={14} /> Add review
											</Button>
										</PopoverTrigger>
										<PopoverContent className="w-[320px] rounded-xl border border-border bg-overlay p-4 shadow-xl">
											<div className="flex w-full flex-col gap-3">
												<textarea
													ref={customTextareaRef}
													placeholder="Add a custom review..."
													value={customReviewText}
													onChange={(e) => setCustomReviewText(e.target.value)}
													className="w-full min-h-[100px] rounded-lg bg-surface p-3 text-sm text-foreground outline-none placeholder:text-muted resize-none border border-border focus:border-accent"
												/>
												<div className="flex justify-between items-center pt-1">
													<button
														className="text-sm text-muted cursor-pointer hover:text-foreground transition-colors bg-transparent border-none outline-none"
														onClick={() => setCustomPopoverOpened(false)}
													>
														Cancel
													</button>
													<Button
														size="sm"
														variant="primary"
														className="h-8 text-xs font-semibold px-4 rounded-md"
														onPress={() => {
															const id = customReviewId || `custom-${Date.now()}`;
															handleSaveReview(id, customReviewText);
															setCustomPopoverOpened(false);
														}}
													>
														{customReviewId ? "Save Review" : "Add Review"}
													</Button>
												</div>
											</div>
										</PopoverContent>
									</Popover>
								</div>
								<div className="flex-1 overflow-y-auto p-6">
									{hasReviews ? (
										<div className="flex flex-col gap-3">
											{Object.entries(reviews).map(([id, text]) => (
												<div
													key={id}
													onClick={() => handleReviewClick(id)}
													className={`group relative flex flex-col gap-2 rounded-xl border px-4 pt-5 pb-4 cursor-pointer transition-all duration-200 ${
														selectedBlockId === id
															? "border-accent bg-accent/10"
															: "border-border bg-surface-secondary hover:border-accent/50"
													}`}
												>
													<div className="flex justify-between items-start gap-2">
														<p className="text-sm flex-1 whitespace-pre-wrap break-words m-0 mt-1">
															{text}
														</p>
														<DeleteIconButton
															size="sm"
															icon={<TbX size={14} />}
															className="opacity-0 group-hover:opacity-100 h-6 w-6 rounded-full shrink-0"
															aria-label="Remove review"
															onPress={() => {
																handleSaveReview(id, "");
															}}
														/>
													</div>
												</div>
											))}
										</div>
									) : (
										<div className="flex h-full items-center justify-center text-center text-sm text-muted">
											Hover over any line on the left to add a review.
										</div>
									)}
								</div>

								{/* Footer Actions */}
								<div className="p-4 border-t border-border bg-surface-secondary shrink-0 flex justify-end gap-3 items-center">
									{/* @ts-expect-error placement is valid */}
									<Popover placement="top-end" isOpen={rejectPopoverOpened} onOpenChange={setRejectPopoverOpened}>
										<PopoverTrigger>
											<Button variant="danger-soft" size="sm" isPending={actionMutation.isPending}>
												<TbX size={16} /> Reject
											</Button>
										</PopoverTrigger>
										<PopoverContent className="w-72 rounded-xl border border-border bg-overlay p-4 shadow-xl">
											<div className="flex flex-col gap-3 w-full">
												<span className="text-sm font-medium">Rejection Reason (Optional)</span>
												<textarea
													ref={rejectTextareaRef}
													placeholder="Why are you rejecting this plan?"
													value={rejectReason}
													onChange={(e) => setRejectReason(e.target.value)}
													className="w-full min-h-[60px] rounded-lg bg-surface p-2 text-sm text-foreground outline-none border border-border focus:border-danger"
												/>
												<div className="flex justify-end gap-2 pt-1">
													<Button size="sm" variant="ghost" className="h-7 text-xs px-3" onPress={() => setRejectPopoverOpened(false)}>
														Cancel
													</Button>
													<Button size="sm" variant="danger-soft" className="h-7 text-xs px-3" onPress={() => {
														setRejectPopoverOpened(false);
														handleAction("reject");
													}}>
														Confirm Reject
													</Button>
												</div>
											</div>
										</PopoverContent>
									</Popover>

									<Button
										variant={hasReviews ? "secondary" : "primary"}
										size="sm"
										onPress={() => handleAction(hasReviews ? "review" : "approve")}
										isPending={actionMutation.isPending}
									>
										{hasReviews ? <TbEdit size={16} /> : <TbCheck size={16} />}
										{hasReviews ? "Submit Review" : "Approve Plan"}
									</Button>
								</div>
							</div>
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
