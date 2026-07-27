import { useState } from "react";
import { Card, Button } from "@fluxify/components";
import { TbCopy, TbCheck } from "react-icons/tb";

export function UserMessage({ query }: { query: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = () => {
		navigator.clipboard.writeText(query);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="group flex w-full justify-end">
			<div className="flex max-w-[70%] flex-col items-end gap-1">
				<Card className="rounded-2xl rounded-br-sm border-none bg-default-100 !p-0 shadow-none">
					<div className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed text-foreground/80">
						{query}
					</div>
				</Card>

				<div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
