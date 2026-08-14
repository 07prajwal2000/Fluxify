import { useState, useRef, useEffect } from "react";
import { Card, Button, Typography } from "@fluxify/components";
import { TbCopy, TbCheck } from "react-icons/tb";
import ReactMarkdown from "react-markdown";
import remarkDirective from "remark-directive";
import { remarkDirectiveRehype } from "./remarkDirectiveRehype";
import { ResourceChip } from "./ResourceChip";

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

	useEffect(() => {
		const checkOverflow = () => {
			if (contentRef.current) {
				setIsOverflowing(contentRef.current.scrollHeight > 200);
			}
		};
		// Check immediately
		checkOverflow();
		// Also check after a tiny delay in case images or fonts load
		const timeout = setTimeout(checkOverflow, 50);
		return () => clearTimeout(timeout);
	}, [query]);

	return (
		<div className="group flex w-full justify-end">
			<div className="flex max-w-[65%] flex-col items-end gap-1">
				<Card className="rounded-2xl rounded-br-sm border-none bg-default-100 !p-0 shadow-none relative overflow-hidden">
					<div 
						ref={contentRef}
						className={`px-4 py-3 text-sm leading-relaxed text-foreground/80 ${!isExpanded ? 'max-h-[200px] overflow-hidden' : ''}`}
					>
						<ReactMarkdown
							remarkPlugins={[remarkDirective, remarkDirectiveRehype]}
							components={{
								p: ({ children }: any) => <p className="m-0 mb-2 last:mb-0 whitespace-pre-wrap">{children}</p>,
								"ai-resource": (props: any) => <ResourceChip {...props} />
							} as any}
						>
							{query}
						</ReactMarkdown>
					</div>

					{isOverflowing && !isExpanded && (
						<div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-default-100 to-transparent flex items-end justify-center pb-2 z-10 pointer-events-none">
							<button 
								onClick={() => setIsExpanded(true)}
								className="text-xs text-[var(--accent)] font-medium hover:underline bg-default-100/90 px-3 py-1 rounded-md pointer-events-auto backdrop-blur-sm"
							>
								Read more
							</button>
						</div>
					)}
					{isExpanded && (
						<div className="flex justify-center py-2 border-t border-border bg-default-100">
							<button 
								onClick={() => setIsExpanded(false)}
								className="text-xs text-muted font-medium hover:text-foreground"
							>
								Show less
							</button>
						</div>
					)}
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
						{copied ? (
							<TbCheck size={14} className="text-success" />
						) : (
							<TbCopy size={14} />
						)}
					</Button>
				</div>
			</div>
		</div>
	);
}
