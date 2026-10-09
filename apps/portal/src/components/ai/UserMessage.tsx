import { Button, Card } from "@fluxify/components";
import { useEffect, useRef, useState } from "react";
import { TbCheck, TbCopy } from "react-icons/tb";
import ReactMarkdown from "react-markdown";
import remarkDirective from "remark-directive";
import { refComponents } from "./AgentRef";
import { remarkDirectiveRehype } from "./remarkDirectiveRehype";

export function UserMessage({ query }: { query: string }) {
	const [copied, setCopied] = useState(false);
	const [isExpanded, setIsExpanded] = useState(false);
	const [isOverflowing, setIsOverflowing] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);

	const handleCopy = () => {
		// Strip out the data payload from any resource tags so the copied text is clean
		const cleanQuery = query.replace(/\sdata="[^"]*"/g, "");
		navigator.clipboard.writeText(cleanQuery);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
	// Measured while clamped to 6 lines: it overflows only if the content is taller than the clamp.
	useEffect(() => {
		const el = contentRef.current;
		if (el) setIsOverflowing(el.scrollHeight > el.clientHeight + 1);
	}, [query]);

	return (
		<div className="group flex w-full justify-end">
			<div className="flex max-w-[65%] flex-col items-end gap-1">
				<Card className="relative overflow-hidden rounded-2xl rounded-br-sm border-none bg-default-100 !p-0 shadow-none">
					<div className="px-4 py-3 text-sm leading-relaxed text-foreground/80">
						<div
							ref={contentRef}
							className={`relative ${isExpanded ? "" : "max-h-[calc(6*1.625em)] overflow-hidden"}`}
						>
							<ReactMarkdown
								remarkPlugins={[remarkDirective, remarkDirectiveRehype]}
								components={
									{
										p: ({ children }: any) => (
											<p className="m-0 mb-2 last:mb-0 whitespace-pre-wrap">{children}</p>
										),
										...refComponents,
									} as any
								}
							>
								{query}
							</ReactMarkdown>
							{isOverflowing && !isExpanded && (
								<div className="pointer-events-none absolute right-0 bottom-0 left-0 h-8 bg-gradient-to-t from-default-100 to-transparent" />
							)}
						</div>
						{isOverflowing && (
							<button
								type="button"
								onClick={() => setIsExpanded((v) => !v)}
								className="mt-1 text-xs font-medium text-[var(--accent)] hover:underline"
							>
								{isExpanded ? "Show less" : "Read more"}
							</button>
						)}
					</div>
				</Card>

				<div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 mt-1">
					<Button
						isIconOnly
						size="sm"
						variant="ghost"
						className="h-6 w-6 rounded-md text-muted hover:bg-default-200 hover:text-foreground"
						onPress={handleCopy}
						aria-label="Copy message"
					>
						{copied ? <TbCheck size={14} className="text-success" /> : <TbCopy size={14} />}
					</Button>
				</div>
			</div>
		</div>
	);
}
