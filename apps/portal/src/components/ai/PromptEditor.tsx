import { useState, useEffect, useRef } from "react";
import { TbCommand, TbAt, TbArrowUp, TbPlayerStopFilled, TbStack2, TbCloudCog, TbSquareKey, TbBox } from "react-icons/tb";
import { Button } from "@fluxify/components";
import { Input, Spinner } from "@fluxify/components";
import { ModelSelect, type AiModel } from "./ModelSelect";
import { ApplyModeSelect } from "./ApplyModeSelect";
import { SyntaxHelpModal } from "./SyntaxHelpModal";
import { STARTERS } from "./starters";
import { integrationsQuery } from "@/query/integrationsQuery";
import { useAiHarnessStore } from "@/store/aiHarness";
import { useDebounce } from "@/hooks/useDebounce";
import { findResourceQuery } from "@/query/findResourceQuery";
import { integrationIcons } from "@fluxify/components";

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { KEY_ENTER_COMMAND, KEY_DOWN_COMMAND, COMMAND_PRIORITY_EDITOR, COMMAND_PRIORITY_HIGH, $getSelection, $isRangeSelection } from "lexical";

import { ResourceNode } from "./lexical/ResourceNode";
import { ResourcePlugin, INSERT_RESOURCE_COMMAND } from "./lexical/ResourcePlugin";
import { markdownToLexical, lexicalToMarkdown, insertMarkdownAtSelection } from "./lexical/MarkdownTransformer";

const PLACEHOLDERS = [
	"Generate a blog API with rate limiting, Redis cache...",
	...STARTERS.map((s) => s.prompt),
];

function EditorLogicPlugin({ 
	value, 
	onChange, 
	onSubmit, 
	onAtTrigger
}: { 
	value: string, 
	onChange: (v: string) => void,
	onSubmit: () => void,
	onAtTrigger: () => void
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
			COMMAND_PRIORITY_HIGH
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
							if (!prevChar || /\s/.test(prevChar) || prevChar === '\n') {
								setTimeout(() => onAtTrigger(), 0);
							}
						}
					});
				}
				return false;
			},
			COMMAND_PRIORITY_HIGH
		);
	}, [editor, onAtTrigger]);

	return null;
}

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
	const selectedModelId = useAiHarnessStore((s) => s.selectedModelId);
	const setSelectedModelId = useAiHarnessStore((s) => s.setSelectedModelId);
	const applyMode = useAiHarnessStore((s) => s.applyMode);
	const setApplyMode = useAiHarnessStore((s) => s.setApplyMode);

	const [model, setModel] = useState<string>(selectedModelId || defaultModelId || "");
	const [helpOpen, setHelpOpen] = useState(false);

	const testConn = integrationsQuery.testExistingConnection.mutation(projectId);
	const [connStatus, setConnStatus] = useState<"testing" | "success" | "error" | "idle">("idle");

	// Popover & Search State
	const [popoverOpen, setPopoverOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [wasAtTyped, setWasAtTyped] = useState(false);
	const debouncedQuery = useDebounce(searchQuery, 300);
	const { data: searchResults, isLoading, isFetching } = findResourceQuery.search.useQuery(projectId, debouncedQuery);
	
	const isDebouncing = searchQuery !== debouncedQuery;
	const isSearchLoading = isDebouncing || isLoading || isFetching;

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

	const actualPlaceholder = isDisabled ? "Please review the implementation plan to continue..." : (typewriter ? twPlaceholder + (charIndex < PLACEHOLDERS[phIndex].length ? "|" : "") : placeholder);

	// Reset index when results change
	useEffect(() => {
		setSelectedIndex(0);
	}, [searchResults?.results]);

	const closePopover = () => {
		setPopoverOpen(false);
		setWasAtTyped(false);
	};

	// Click outside
	useEffect(() => {
		if (!popoverOpen) return;
		const handleClick = (e: MouseEvent) => {
			if (
				popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
				triggerRef.current && !triggerRef.current.contains(e.target as Node)
			) {
				closePopover();
			}
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, [popoverOpen]);

	// Sync default model if it changes or if models load late
	useEffect(() => {
		if (models.length > 0) {
			if (model && !models.some((m) => m.id === model)) {
				setSelectedModelId(null);
				setModel(defaultModelId || "");
			} else if (!model && defaultModelId) {
				setModel(defaultModelId);
			}
		}
	}, [defaultModelId, model, models, setSelectedModelId]);

	useEffect(() => {
		if (!model) return;
		setConnStatus("testing");
		testConn.mutate(model, {
			onSuccess: (res) => {
				setConnStatus(res.success ? "success" : "error");
			},
			onError: () => {
				setConnStatus("error");
			}
		});
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [model, projectId]);

	const trimmed = value.trim();
	const canSend = trimmed.length > 0 && !isPending && !isDisabled && connStatus === "success";

	const submit = () => {
		if (!canSend) return;
		const selectedModel = models.find(m => m.id === model);
		const isFallback = !!selectedModel?.isFallback;
		onSubmit(trimmed, model, isFallback);
	};

    const initialConfig = {
        namespace: 'PromptEditor',
        theme: {
            paragraph: 'm-0 p-0',
        },
        onError: (error: Error) => {
            console.error(error);
        },
        nodes: [ResourceNode]
    };

	return (
		<div className={`relative rounded-2xl border border-border bg-surface-secondary p-4 shadow-2xl transition-colors focus-within:border-accent ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
			{popoverOpen && (
				<div ref={popoverRef} className="absolute bottom-[calc(100%+8px)] left-0 w-full rounded-xl border border-border bg-overlay p-2 shadow-xl z-50">
					<div className="w-full">
						<div className="flex items-center gap-3">
							<Input 
								value={searchQuery}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
								onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                    if (e.key === "Escape") {
                                        e.preventDefault();
                                        closePopover();
                                        document.dispatchEvent(new CustomEvent('focus-editor'));
                                        return;
                                    }
                                    if (!searchResults?.results || searchResults.results.length === 0) return;
                                    
                                    if (e.key === "ArrowDown") {
                                        e.preventDefault();
                                        setSelectedIndex((prev) => Math.min(prev + 1, searchResults.results.length - 1));
                                    } else if (e.key === "ArrowUp") {
                                        e.preventDefault();
                                        setSelectedIndex((prev) => Math.max(prev - 1, 0));
                                    } else if (e.key === "Enter") {
                                        e.preventDefault();
                                        const res = searchResults.results[selectedIndex];
                                        if (res) {
                                            document.dispatchEvent(new CustomEvent('insert-resource', {
                                                detail: { res, wasAtTyped }
                                            }));
                                            closePopover();
                                            setSearchQuery("");
                                        }
                                    }
                                }}
								placeholder="Search resources..." 
								autoFocus
								className="w-64 bg-surface hover:bg-surface-secondary focus-within:ring-1 focus-within:ring-focus border-border rounded-lg h-9 min-h-9 px-3 text-sm text-foreground placeholder:text-muted"
							/>
							{isSearchLoading && (
								<Spinner size="sm" color="current" />
							)}
						</div>
						<div className="mt-2 h-[150px] overflow-y-auto w-full">
							{isSearchLoading ? (
								<div className="p-3 text-center text-xs text-muted flex items-center justify-center h-full">Searching...</div>
							) : searchResults?.results && searchResults.results.length > 0 ? (
								<div className="flex flex-col gap-1">
									{searchResults.results.map((res, i) => (
										<button
											key={res.id}
											onClick={() => {
                                                document.dispatchEvent(new CustomEvent('insert-resource', {
                                                    detail: { res, wasAtTyped }
                                                }));
                                                closePopover();
                                                setSearchQuery("");
                                            }}
											className={`flex items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-secondary ${i === selectedIndex ? "bg-surface-secondary" : ""}`}
										>
											<div className="flex-shrink-0 text-muted">
												{res.type === "route" ? <TbStack2 size={16} /> :
												 res.type === "app_config" ? <TbSquareKey size={16} /> :
												 res.type === "integration" ? (
													res.variant && integrationIcons[res.variant] ? (
														<span className="[&>svg]:w-4 [&>svg]:h-4 inline-flex items-center">
															{integrationIcons[res.variant]}
														</span>
													) : <TbCloudCog size={16} />
												 ) :
												 <TbBox size={16} />}
											</div>
											<div className="flex flex-col">
												<span className="text-sm font-medium text-foreground">{res.name}</span>
												{res.description && (
													<span className="text-xs text-muted line-clamp-1">{res.description}</span>
												)}
											</div>
										</button>
									))}
								</div>
							) : debouncedQuery ? (
								<div className="p-3 text-center text-xs text-muted flex items-center justify-center h-full">No resources found</div>
							) : (
								<div className="p-3 text-center text-xs text-muted flex items-center justify-center h-full">Type to search routes, integrations, and configs</div>
							)}
						</div>
					</div>
				</div>
			)}
			
            <LexicalComposer initialConfig={initialConfig}>
                <div className="relative w-full min-h-[46px]">
                    <PlainTextPlugin
                        contentEditable={<ContentEditable className="w-full resize-none bg-transparent px-1 text-sm leading-relaxed text-foreground outline-none min-h-[46px]" />}
                        placeholder={<div className="absolute top-0 left-1 pointer-events-none text-muted text-sm">{actualPlaceholder}</div>}
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

			<div className="mt-2 flex items-end justify-between gap-3">
				<div className="flex items-center gap-1 text-muted">
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
					<Button
						isIconOnly
						size="sm"
						variant="ghost"
						className="rounded-full hover:bg-surface-secondary hover:text-foreground"
						aria-label="Prompt syntax help"
						onPress={() => setHelpOpen(true)}
					>
						<TbCommand size={18} />
					</Button>
				</div>
				<div className="flex items-center gap-3">
					<ApplyModeSelect value={applyMode} onChange={setApplyMode} />
					<ModelSelect
						projectId={projectId} 
						value={model} 
						models={models} 
						onChange={(val) => {
							setModel(val);
							setSelectedModelId(val || null);
						}} 
					/>
					{isRunning ? (
						<Button
							isIconOnly
							variant="danger"
							className="rounded-xl h-8 w-8"
							aria-label="Stop"
							onPress={onStop}
						>
							<TbPlayerStopFilled size={18} />
						</Button>
					) : (
						<Button
							isIconOnly
							variant="primary"
							className="rounded-xl h-8 w-8"
							aria-label="Send"
							isDisabled={!canSend}
							isPending={isPending || connStatus === "testing"}
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

import { PASTE_COMMAND } from "lexical";

function EditorEventsPlugin() {
    const [editor] = useLexicalComposerContext();
    useEffect(() => {
        const insertHandler = (e: any) => {
            const { res, wasAtTyped } = e.detail;
            editor.focus();
            requestAnimationFrame(() => {
                const data = encodeURIComponent(JSON.stringify(res));
                editor.dispatchCommand(INSERT_RESOURCE_COMMAND, {
                    resourceType: res.type,
                    identifier: res.id,
                    name: res.name,
                    data: data,
                    replaceAt: wasAtTyped
                });
            });
        };
        const focusHandler = () => {
            editor.focus();
        };

        const removePaste = editor.registerCommand(
            PASTE_COMMAND,
            (e: ClipboardEvent | InputEvent) => {
                let text = "";
                if (e instanceof ClipboardEvent) {
                    text = e.clipboardData?.getData("text/plain") || "";
                }
                
                if (text && text.includes(":resource{")) {
                    e.preventDefault();
                    editor.update(() => {
                        insertMarkdownAtSelection(text);
                    });
                    return true;
                }
                return false;
            },
            COMMAND_PRIORITY_HIGH
        );

        document.addEventListener('insert-resource', insertHandler);
        document.addEventListener('focus-editor', focusHandler);
        
        return () => {
            document.removeEventListener('insert-resource', insertHandler);
            document.removeEventListener('focus-editor', focusHandler);
            removePaste();
        };
    }, [editor]);
    return null;
}
