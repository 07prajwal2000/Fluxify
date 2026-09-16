import {
	Button,
	Description,
	InputGroup,
	Label,
	Popover,
	PopoverContent,
	PopoverTrigger,
	TextField,
} from "@heroui/react";
import clsx from "clsx";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiChevronDown } from "react-icons/fi";
import { SiJavascript } from "react-icons/si";
import { TbExternalLink, TbInfoCircle, TbX } from "react-icons/tb";
import { isJsExpression, readExpression, writeExpression } from "./expression";
import { JsEditorModal } from "./JsEditorModal";
import { LegacyExpressionModal } from "./LegacyExpressionModal";
import { SuggestionsDropdown } from "./SuggestionsDropdown";
import type { CodeSnippet } from "./snippets";

export type JsTextFieldProps = {
	/** Stored value. A `js:` prefix means it holds a JavaScript expression. */
	value: string;
	onChange: (value: string) => void;
	label?: string;
	placeholder?: string;
	/** Shown under the field. */
	description?: ReactNode;
	/** Longer help behind an info button beside the label, so it doesn't clutter the form. */
	info?: FieldInfo;
	isDisabled?: boolean;
	fullWidth?: boolean;
	variant?: "primary" | "secondary";
	className?: string;
	name?: string;
	onBlur?: () => void;
	/** If true, disables JavaScript expression mode and hides the JS toggle. */
	disableJs?: boolean;
	/** Optional list of autocomplete suggestions */
	suggestions?: string[];
	/** Optional list of custom snippets to show in the modal sidebar */
	snippets?: CodeSnippet[];
	/** If true, uses the legacy compact modal instead of the two-column editor modal */
	legacyModal?: boolean;
};

export type FieldInfo = {
	content: ReactNode;
	/** Shown as code under the content, one example per line. */
	example?: string;
	/** Opens in a new tab. */
	docsUrl?: string;
};

export function FieldInfoButton({ label, info }: { label?: string; info: FieldInfo }) {
	return (
		<Popover>
			<PopoverTrigger>
				<Button
					isIconOnly
					size="sm"
					variant="ghost"
					aria-label={label ? `About ${label}` : "More info"}
					className="h-5 w-5 min-w-0 cursor-pointer rounded-full text-muted hover:text-foreground"
				>
					<TbInfoCircle size={14} />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="max-w-xs rounded-lg border border-border bg-overlay p-3 text-sm text-foreground shadow-xl">
				<div className="flex flex-col gap-2">
					<div>{info.content}</div>
					{info.example && (
						<div className="flex flex-col gap-1">
							<span className="text-xs text-muted">e.g.</span>
							<pre className="whitespace-pre-wrap rounded-md bg-surface-secondary px-2 py-1 font-mono text-xs">
								{info.example}
							</pre>
						</div>
					)}
					{info.docsUrl && (
						<a
							href={info.docsUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 self-start text-xs text-accent hover:underline"
						>
							View docs <TbExternalLink size={12} />
						</a>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}

/**
 * A text field that can hold either a literal or a JavaScript expression. Plain
 * mode behaves exactly like a `TextField` — same `value`/`onChange` contract.
 * The `JS` button swaps it into expression mode, editing code in a dedicated
 * two-column modal featuring Monaco editor and a snippets panel.
 */
export function JsTextField({
	value,
	onChange,
	label,
	placeholder,
	description,
	info,
	isDisabled,
	fullWidth,
	variant = "secondary",
	className,
	name,
	onBlur,
	disableJs = false,
	suggestions,
	snippets,
	legacyModal = false,
}: JsTextFieldProps) {
	const triggerRef = useRef<HTMLDivElement>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
	const [draft, setDraft] = useState("");

	const isJs = !disableJs && isJsExpression(value);
	const title = label ? `${label} — JavaScript` : "JavaScript Expression";

	const hasSuggestions = !isJs && Array.isArray(suggestions) && suggestions.length > 0;

	const filteredSuggestions = useMemo(() => {
		if (!suggestions || suggestions.length === 0) return [];
		const current = (value || "").toLowerCase().trim();
		if (!current || current === "*") return suggestions;
		const matches = suggestions.filter((s) => s.toLowerCase().includes(current));
		return matches.length > 0 ? matches : suggestions;
	}, [suggestions, value]);

	// Close suggestions when clicking outside
	useEffect(() => {
		if (!isSuggestionsOpen) return;
		const handleClickOutside = (event: MouseEvent | TouchEvent) => {
			if (
				triggerRef.current &&
				!triggerRef.current.contains(event.target as Node)
			) {
				setIsSuggestionsOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [isSuggestionsOpen]);

	const openModal = useCallback(() => {
		if (isDisabled) return;
		setIsSuggestionsOpen(false);
		setDraft(isJs ? readExpression(value) : value || "");
		setIsModalOpen(true);
	}, [isDisabled, isJs, value]);

	const closeModal = useCallback(() => {
		setIsModalOpen(false);
	}, []);

	const save = useCallback(() => {
		onChange(writeExpression(draft));
		closeModal();
	}, [draft, onChange, closeModal]);

	const clear = useCallback(() => {
		onChange("");
		closeModal();
	}, [onChange, closeModal]);

	const handleInputClick = useCallback(() => {
		if (isDisabled) return;
		if (isJs) {
			openModal();
		} else if (hasSuggestions) {
			setIsSuggestionsOpen(true);
		}
	}, [isJs, isDisabled, openModal, hasSuggestions]);

	const handleInputFocus = useCallback(() => {
		if (isDisabled) return;
		if (!isJs && hasSuggestions) {
			setIsSuggestionsOpen(true);
		}
	}, [isDisabled, isJs, hasSuggestions]);

	const handleValueChange = useCallback(
		(nextVal: string) => {
			onChange(nextVal);
			if (hasSuggestions && !isSuggestionsOpen) {
				setIsSuggestionsOpen(true);
			}
		},
		[onChange, hasSuggestions, isSuggestionsOpen],
	);

	const handleInputKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (isDisabled) return;
			if (isJs) {
				if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
					e.preventDefault();
					openModal();
				}
			} else {
				if (e.key === "Escape" && isSuggestionsOpen) {
					e.preventDefault();
					setIsSuggestionsOpen(false);
				} else if (e.key === "ArrowDown" && hasSuggestions && !isSuggestionsOpen) {
					e.preventDefault();
					setIsSuggestionsOpen(true);
				}
			}
		},
		[isJs, isDisabled, openModal, hasSuggestions, isSuggestionsOpen],
	);

	return (
		<>
			<TextField
				className={clsx("min-w-0", className)}
				fullWidth={fullWidth}
				isDisabled={isDisabled}
				name={name}
				onChange={isJs ? undefined : handleValueChange}
				value={isJs ? readExpression(value) : value}
				variant={variant}
			>
				{label &&
					(info ? (
						<div className="flex items-center gap-1">
							<Label>{label}</Label>
							<FieldInfoButton label={label} info={info} />
						</div>
					) : (
						<Label>{label}</Label>
					))}
				<div ref={triggerRef} className="relative w-full min-w-0">
					<InputGroup fullWidth={fullWidth} variant={variant} className="w-full min-w-0">
						<InputGroup.Input
							className={clsx(
								"min-w-0 flex-1",
								isJs && "font-mono text-xs cursor-pointer",
							)}
							onBlur={isJs ? undefined : onBlur}
							onFocus={handleInputFocus}
							onClick={handleInputClick}
							onKeyDown={handleInputKeyDown}
							placeholder={isJs ? "JavaScript expression" : placeholder}
							readOnly={isJs}
						/>
						<InputGroup.Suffix className="shrink-0 gap-0.5 px-1.5">
							{hasSuggestions && (
								<Button
									aria-label="Toggle suggestions"
									isIconOnly
									isDisabled={isDisabled}
									size="sm"
									variant="ghost"
									className="h-6 w-6 min-w-6 p-0 text-muted hover:text-foreground"
									onPress={() => setIsSuggestionsOpen((prev) => !prev)}
								>
									<FiChevronDown
										className={clsx(
											"size-3.5 transition-transform",
											isSuggestionsOpen && "rotate-180",
										)}
									/>
								</Button>
							)}
							{!disableJs && (
								<>
									{isJs ? (
										<>
											<Button
												aria-label="Clear expression"
												isIconOnly
												isDisabled={isDisabled}
												size="sm"
												variant="ghost"
												className="h-6 w-6 min-w-6 p-0 text-muted hover:text-foreground"
												onPress={clear}
											>
												<TbX className="size-3.5" />
											</Button>
											<Button
												aria-label="Edit JavaScript expression"
												isIconOnly
												isDisabled={isDisabled}
												size="sm"
												variant="ghost"
												className="h-6 w-6 min-w-6 p-0 text-accent hover:text-accent"
												onPress={openModal}
											>
												<SiJavascript className="size-3.5" />
											</Button>
										</>
									) : (
										<Button
											aria-label="Use a JavaScript expression"
											isIconOnly
											isDisabled={isDisabled}
											size="sm"
											variant="ghost"
											className="h-6 w-6 min-w-6 p-0 text-muted hover:text-foreground"
											onPress={openModal}
										>
											<SiJavascript className="size-3.5" />
										</Button>
									)}
								</>
							)}
						</InputGroup.Suffix>
					</InputGroup>

					{hasSuggestions && isSuggestionsOpen && (
						<SuggestionsDropdown
							dropdownRef={dropdownRef}
							filteredSuggestions={filteredSuggestions}
							onSelect={(item) => {
								onChange(item);
								setIsSuggestionsOpen(false);
							}}
							value={value}
						/>
					)}
				</div>
				{description && <Description>{description}</Description>}
			</TextField>

			{legacyModal ? (
				<LegacyExpressionModal
					isOpen={isModalOpen}
					onChange={setDraft}
					onClose={closeModal}
					onSave={save}
					title={title}
					value={draft}
				/>
			) : (
				<JsEditorModal
					isOpen={isModalOpen}
					onChange={setDraft}
					onClose={closeModal}
					onSave={save}
					readOnly={isDisabled}
					snippets={snippets}
					title={title}
					value={draft}
				/>
			)}
		</>
	);
}
