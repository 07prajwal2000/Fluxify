import { Button } from "@fluxify/components";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_EDITOR,
	COMMAND_PRIORITY_HIGH,
	KEY_DOWN_COMMAND,
	KEY_ENTER_COMMAND,
} from "lexical";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { TbArrowUp, TbAt, TbPlayerStopFilled } from "react-icons/tb";
import { AgentModelLabel } from "./AgentModel";
import { EditorEventsPlugin } from "./EditorEventsPlugin";
import { lexicalToMarkdown, markdownToLexical } from "./lexical/MarkdownTransformer";
import { ResourceNode } from "./lexical/ResourceNode";
import { ResourcePlugin } from "./lexical/ResourcePlugin";
import { MentionPopover } from "./MentionPopover";
import { STARTERS } from "./starters";

const PLACEHOLDERS = [
	"Generate a blog API with rate limiting, Redis cache...",
	...STARTERS.map((s) => s.prompt),
];

function EditorLogicPlugin({
	value,
	onChange,
	onSubmit,
	onAtTrigger,
}: {
	value: string;
	onChange: (v: string) => void;
	onSubmit: () => void;
	onAtTrigger: () => void;
}) {
	const [editor] = useLexicalComposerContext();
	const isFirstRender = useRef(true);

	useEffect(() => {
		if (isFirstRender.current) {
			isFirstRender.current = false;
			markdownToLexical(value, editor);
		} else {
			const currentMarkdown = lexicalToMarkdown(editor);
			if (value === "" && currentMarkdown !== "") {
				markdownToLexical(value, editor);
			}
		}
	}, [value, editor]);

	useEffect(() => {
		return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
			if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
			onChange(lexicalToMarkdown(editor));
		});
	}, [editor, onChange]);

	useEffect(() => {
		return editor.registerCommand(
			KEY_ENTER_COMMAND,
			(e: KeyboardEvent) => {
				if (!e.shiftKey) {
					e.preventDefault();
					onSubmit();
					return true;
				}
				return false;
			},
			COMMAND_PRIORITY_HIGH,
		);
	}, [editor, onSubmit]);

	useEffect(() => {
		return editor.registerCommand(
			KEY_DOWN_COMMAND,
			(e: KeyboardEvent) => {
				if (e.key === "@") {
					editor.getEditorState().read(() => {
						const sel = $getSelection();
						if ($isRangeSelection(sel)) {
							const textNode = sel.anchor.getNode();
							const offset = sel.anchor.offset;
							const textContent = textNode.getTextContent();
							const prevChar = textContent[offset - 1];
							if (!prevChar || /\s/.test(prevChar) || prevChar === "\n") {
								setTimeout(() => onAtTrigger(), 0);
							}
						}
					});
				}
				return false;
			},
			COMMAND_PRIORITY_HIGH,
		);
	}, [editor, onAtTrigger]);

	return null;
}

type Props = {
	projectId: string;
	value: string;
	onChange: (value: string) => void;
	onSubmit: (query: string) => void;
	isPending?: boolean;
	minRows?: number;
	maxRows?: number;
	placeholder?: string;
	typewriter?: boolean;
	isRunning?: boolean;
	onStop?: () => void;
	isDisabled?: boolean;
	/** Next to the model name: the mode and effort pickers. */
	controls?: ReactNode;
};

export function PromptEditor({
	projectId,
	value,
	onChange,
	onSubmit,
	isPending,
	minRows = 1,
	maxRows = 2,
	placeholder = "Message AI...",
	typewriter = true,
	isRunning,
	onStop,
	isDisabled,
	controls,
}: Props) {
	const [popoverOpen, setPopoverOpen] = useState(false);
	const [wasAtTyped, setWasAtTyped] = useState(false);
	const popoverRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

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
				setTwPlaceholder((p) => p + current[charIndex]);
				setCharIndex((c) => c + 1);
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

	const actualPlaceholder = typewriter
		? twPlaceholder + (charIndex < PLACEHOLDERS[phIndex].length ? "|" : "")
		: placeholder;

	const closePopover = () => {
		setPopoverOpen(false);
		setWasAtTyped(false);
	};

	// Click outside
	useEffect(() => {
		if (!popoverOpen) return;
		const handleClick = (e: MouseEvent) => {
			if (
				popoverRef.current &&
				!popoverRef.current.contains(e.target as Node) &&
				triggerRef.current &&
				!triggerRef.current.contains(e.target as Node)
			) {
				closePopover();
			}
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [popoverOpen]);

	const trimmed = value.trim();
	// `!isRunning` matters for Enter, not the button — the button is swapped for
	// Stop while a run is live, but the editor's Enter handler calls submit()
	// directly and was firing a second run over the top of the first.
	const canSend = trimmed.length > 0 && !isPending && !isDisabled && !isRunning;

	const submit = () => {
		if (canSend) onSubmit(trimmed);
	};

	const initialConfig = {
		namespace: "PromptEditor",
		theme: {
			paragraph: "m-0 p-0",
		},
		onError: (error: Error) => {
			console.error(error);
		},
		nodes: [ResourceNode],
	};

	return (
		<div
			className={`relative rounded-2xl border border-border bg-surface-secondary p-4 shadow-2xl transition-colors focus-within:border-accent ${isDisabled ? "opacity-50 pointer-events-none" : ""}`}
		>
			{popoverOpen && (
				<MentionPopover
					ref={popoverRef}
					projectId={projectId}
					wasAtTyped={wasAtTyped}
					onClose={closePopover}
				/>
			)}

			<LexicalComposer initialConfig={initialConfig}>
				<div className="relative w-full min-h-[46px]">
					<PlainTextPlugin
						contentEditable={
							<ContentEditable className="w-full resize-none bg-transparent px-1 text-sm leading-relaxed text-foreground outline-none min-h-[46px]" />
						}
						placeholder={
							<div className="absolute top-0 left-1 pointer-events-none text-muted text-sm">
								{actualPlaceholder}
							</div>
						}
						ErrorBoundary={LexicalErrorBoundary}
					/>
					<HistoryPlugin />
					<ResourcePlugin />
					<EditorLogicPlugin
						value={value}
						onChange={onChange}
						onSubmit={submit}
						onAtTrigger={() => {
							setPopoverOpen(true);
							setWasAtTyped(true);
						}}
					/>
					{/* Event listener plugin for inserting resources */}
					<EditorEventsPlugin />
				</div>
			</LexicalComposer>

			<div className="mt-2 flex items-end justify-between gap-2">
				<div className="flex shrink-0 items-center gap-1 text-muted">
					<Button
						ref={triggerRef}
						isIconOnly
						size="sm"
						variant="ghost"
						className="rounded-full hover:bg-surface-secondary hover:text-foreground"
						aria-label="Insert resource"
						onPress={() => {
							if (popoverOpen) {
								closePopover();
							} else {
								setPopoverOpen(true);
							}
						}}
					>
						<TbAt size={18} />
					</Button>
				</div>
				<div className="flex min-w-0 flex-1 items-center justify-end gap-2">
					{controls}
					<AgentModelLabel projectId={projectId} />
					{isRunning ? (
						<Button
							isIconOnly
							variant="danger"
							className="rounded-xl h-8 w-8 shrink-0"
							aria-label="Stop"
							onPress={onStop}
						>
							<TbPlayerStopFilled size={18} />
						</Button>
					) : (
						<Button
							isIconOnly
							variant="primary"
							className="rounded-xl h-8 w-8 shrink-0"
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
		</div>
	);
}
