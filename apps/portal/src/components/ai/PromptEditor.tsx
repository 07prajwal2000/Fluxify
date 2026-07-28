import { useState, useEffect, useRef } from "react";
import { TbCommand, TbAt, TbArrowUp, TbPlayerStopFilled } from "react-icons/tb";
import { Button, Popover, PopoverTrigger, PopoverContent } from "@fluxify/components";
import { ModelSelect, type AiModel } from "./ModelSelect";
import { SyntaxHelpModal } from "./SyntaxHelpModal";
import { STARTERS } from "./starters";

const PLACEHOLDERS = [
	"Generate a blog API with rate limiting, Redis cache...",
	...STARTERS.map((s) => s.prompt),
];

type Props = {
	projectId: string;
	value: string;
	onChange: (value: string) => void;
	onSubmit: (query: string, model: string, isFallback: boolean) => void;
	isPending?: boolean;
	models: AiModel[];
	defaultModelId?: string;
	minRows?: number;
	maxRows?: number;
	placeholder?: string;
	typewriter?: boolean;
	isRunning?: boolean;
	onStop?: () => void;
	isDisabled?: boolean;
};

export function PromptEditor({ 
	projectId, value, onChange, onSubmit, isPending, models, defaultModelId, minRows = 1, maxRows = 2,
	placeholder = "Message AI...", typewriter = true, isRunning, onStop, isDisabled
}: Props) {
	const [model, setModel] = useState<string>(defaultModelId ?? (models[0]?.id || ""));
	const [helpOpen, setHelpOpen] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Typewriter effect
	const [twPlaceholder, setTwPlaceholder] = useState("");
	const [phIndex, setPhIndex] = useState(0);
	const [charIndex, setCharIndex] = useState(0);

	useEffect(() => {
		if (!typewriter) return;
		const current = PLACEHOLDERS[phIndex];
		let timeout: NodeJS.Timeout;
		if (charIndex < current.length) {
			timeout = setTimeout(() => {
				setTwPlaceholder(p => p + current[charIndex]);
				setCharIndex(c => c + 1);
			}, 40); // typing speed
		} else {
			timeout = setTimeout(() => {
				setTwPlaceholder("");
				setCharIndex(0);
				setPhIndex((i) => (i + 1) % PLACEHOLDERS.length);
			}, 3000); // pause before next
		}
		return () => clearTimeout(timeout);
	}, [charIndex, phIndex, typewriter]);

	// Sync default model if it changes or if models load late
	useEffect(() => {
		if (!model && (defaultModelId || models.length > 0)) {
			setModel(defaultModelId ?? models[0]?.id);
		}
	}, [defaultModelId, models, model]);

	// Auto-resize textarea
	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
			textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
		}
	}, [value]);

	const trimmed = value.trim();
	const canSend = trimmed.length > 0 && !isPending && !isDisabled;

	const submit = () => {
		if (!canSend) return;
		const selectedModel = models.find(m => m.id === model);
		const isFallback = !!selectedModel?.isFallback;
		onSubmit(trimmed, model, isFallback);
	};

	return (
		<div className={`relative rounded-2xl border border-white/10 bg-[#161618] p-4 shadow-2xl transition-colors focus-within:border-[#ccff00]/50 ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
			<textarea
				ref={textareaRef}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						submit();
					}
				}}
				disabled={isDisabled}
				placeholder={isDisabled ? "Please review the implementation plan to continue..." : (typewriter ? twPlaceholder + (charIndex < PLACEHOLDERS[phIndex].length ? "|" : "") : placeholder)}
				rows={minRows}
				style={{
					minHeight: minRows === 1 ? "24px" : `${minRows * 23}px`,
					maxHeight: `${maxRows * 23}px`,
				}}
				className="w-full resize-none bg-transparent px-1 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted disabled:cursor-not-allowed"
			/>
			
			<div className="mt-2 flex items-end justify-between gap-3">
				<div className="flex items-center gap-1 text-muted-foreground">
					{/* @ts-expect-error placement is valid in HeroUI Popover */}
					<Popover placement="top">
						<PopoverTrigger>
							<Button
								isIconOnly
								size="sm"
								variant="ghost"
								className="rounded-full hover:bg-white/5 hover:text-foreground data-[pressed]:bg-white/10 data-[pressed]:text-foreground"
								aria-label="Insert resource"
							>
								<TbAt size={18} />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="mb-2 w-64 rounded-xl border border-white/10 bg-[#1e1e20] p-2 shadow-xl outline-none">
							<div className="w-full">
								<input 
									type="text" 
									placeholder="Search resources..." 
									className="w-full rounded-lg bg-black/20 px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-muted"
									autoFocus
								/>
								<div className="p-3 text-center text-xs text-muted">
									No resources found
								</div>
							</div>
						</PopoverContent>
					</Popover>
					<Button
						isIconOnly
						size="sm"
						variant="ghost"
						className="rounded-full hover:bg-white/5 hover:text-foreground"
						aria-label="Prompt syntax help"
						onPress={() => setHelpOpen(true)}
					>
						<TbCommand size={18} />
					</Button>
				</div>
				<div className="flex items-center gap-3">
					<ModelSelect projectId={projectId} value={model} models={models} onChange={setModel} />
					{isRunning ? (
						<Button
							isIconOnly
							className="rounded-xl bg-red-500 text-white hover:bg-red-600 h-8 w-8"
							aria-label="Stop"
							onPress={onStop}
						>
							<TbPlayerStopFilled size={18} />
						</Button>
					) : (
						<Button
							isIconOnly
							className="rounded-xl bg-[#ccff00] text-black hover:bg-[#b3e600] disabled:opacity-50 disabled:bg-[#ccff00]/50 h-8 w-8"
							aria-label="Send"
							isDisabled={!canSend}
							isPending={isPending}
							onPress={submit}
						>
							<TbArrowUp size={18} />
						</Button>
					)}
				</div>
			</div>

			<SyntaxHelpModal isOpen={helpOpen} onOpenChange={setHelpOpen} />
		</div>
	);
}
