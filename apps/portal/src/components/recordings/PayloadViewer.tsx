import { Button, CodeViewer } from "@fluxify/components";
import { useState } from "react";
import { TbCheck, TbChevronDown, TbChevronRight, TbCopy } from "react-icons/tb";

const asJson = (value: unknown) =>
	value === undefined || value === null ? "" : JSON.stringify(value, null, 2);

/**
 * Collapsible card for payload data (Input / Output) with copy-to-clipboard
 * and indicator when data was cut off at the 8 KB limit.
 */
export function PayloadViewer({
	title,
	value,
	truncated,
}: {
	title: string;
	value: unknown;
	truncated?: boolean;
}) {
	const [isOpen, setIsOpen] = useState(true);
	const [copied, setCopied] = useState(false);
	const text = asJson(value);

	const handleCopy = async () => {
		if (!text) return;
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="rounded-md border border-border bg-background">
			<div className="flex items-center justify-between px-3 py-1.5">
				<button
					type="button"
					onClick={() => setIsOpen((prev) => !prev)}
					className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-foreground hover:text-accent"
				>
					{isOpen ? <TbChevronDown size={14} /> : <TbChevronRight size={14} />}
					<span>{title}</span>
					{truncated && (
						<span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-normal text-warning">
							Truncated at 8 KB
						</span>
					)}
				</button>
				{text && (
					<Button
						size="sm"
						variant="ghost"
						isIconOnly
						aria-label={`Copy ${title}`}
						onPress={() => void handleCopy()}
					>
						{copied ? (
							<TbCheck size={14} className="text-success" />
						) : (
							<TbCopy size={14} className="text-muted" />
						)}
					</Button>
				)}
			</div>
			{isOpen && (
				<div className="border-t border-border p-2">
					{text ? (
						<CodeViewer value={text} language="json" height={160} />
					) : (
						<p className="p-1 text-xs text-muted">Nothing recorded.</p>
					)}
				</div>
			)}
		</div>
	);
}
