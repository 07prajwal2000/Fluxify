import {
	Button,
	Description,
	InputGroup,
	Label,
	Modal,
	Popover,
	popoverVariants,
	TextField,
} from "@heroui/react";
import clsx from "clsx";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiChevronDown, FiMaximize2, FiMinimize2, FiX } from "react-icons/fi";
import { SiJavascript } from "react-icons/si";
import { ExpressionEditor } from "./ExpressionEditor";
import { isJsExpression, readExpression, writeExpression } from "./expression";

/** Lines shown in the popover editor; the modal gets a taller one. */
const POPOVER_ROWS = 4;
const MODAL_ROWS = 14;

type Surface = "closed" | "popover" | "modal";

export type JsTextFieldProps = {
	/** Stored value. A `js:` prefix means it holds a JavaScript expression. */
	value: string;
	onChange: (value: string) => void;
	label?: string;
	placeholder?: string;
	/** Shown under the field. */
	description?: ReactNode;
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
};

/**
 * A text field that can hold either a literal or a JavaScript expression. Plain
 * mode behaves exactly like a `TextField` — same `value`/`onChange` contract.
 * The `JS` button swaps it into expression mode, editing the code in a popover
 * that can expand into a modal.
 */
export function JsTextField({
	value,
	onChange,
	label,
	placeholder,
	description,
	isDisabled,
	fullWidth,
	variant = "secondary",
	className,
	name,
	onBlur,
	disableJs = false,
	suggestions,
}: JsTextFieldProps) {
	const triggerRef = useRef<HTMLDivElement>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const justClosedRef = useRef<boolean>(false);
	const [surface, setSurface] = useState<Surface>("closed");
	const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
	const [draft, setDraft] = useState("");
	const popover = useMemo(() => popoverVariants(), []);

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

	const open = useCallback(
		(next: Exclude<Surface, "closed">) => {
			if (isDisabled) return;
			setIsSuggestionsOpen(false);
			if (surface === "closed") setDraft(readExpression(value));
			setSurface(next);
		},
		[isDisabled, surface, value],
	);

	const closeSurface = useCallback(() => {
		justClosedRef.current = true;
		setSurface("closed");
		setTimeout(() => {
			justClosedRef.current = false;
		}, 100);
	}, []);

	const save = useCallback(() => {
		onChange(writeExpression(draft));
		closeSurface();
	}, [draft, onChange, closeSurface]);

	const clear = useCallback(() => {
		onChange("");
		closeSurface();
	}, [onChange, closeSurface]);

	const handleInputClick = useCallback(() => {
		if (isDisabled) return;
		if (isJs) {
			if (justClosedRef.current) return;
			if (surface === "closed") {
				open("popover");
			}
		} else if (hasSuggestions) {
			setIsSuggestionsOpen(true);
		}
	}, [isJs, isDisabled, surface, open, hasSuggestions]);

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
					if (surface === "closed" && !justClosedRef.current) {
						open("popover");
					}
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
		[isJs, isDisabled, surface, open, hasSuggestions, isSuggestionsOpen],
	);

	const editor = (surfaceRows: number, trailingButton?: ReactNode) => (
		<ExpressionEditor
			onCancel={closeSurface}
			onChange={setDraft}
			onSave={save}
			rows={surfaceRows}
			title={title}
			trailing={trailingButton}
			value={draft}
		/>
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
				{label && <Label>{label}</Label>}
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
									className="h-6 w-6 min-w-6 p-0 text-muted-foreground hover:text-foreground"
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
												onPress={clear}
											>
												<FiX />
											</Button>
											<Button
												aria-label="Expand editor"
												isIconOnly
												isDisabled={isDisabled}
												size="sm"
												variant="ghost"
												onPress={() => open("modal")}
											>
												<FiMaximize2 />
											</Button>
										</>
									) : (
										<Button
											aria-label="Use a JavaScript expression"
											isIconOnly
											isDisabled={isDisabled}
											size="sm"
											variant="ghost"
											onPress={() => open("popover")}
										>
											<SiJavascript />
										</Button>
									)}
								</>
							)}
						</InputGroup.Suffix>
					</InputGroup>

					{hasSuggestions && isSuggestionsOpen && (
						<div
							ref={dropdownRef}
							className="absolute left-0 top-full mt-1 w-full max-h-56 overflow-y-auto rounded-lg p-1 shadow-2xl border border-zinc-800 bg-zinc-900 z-50"
							style={{
								backgroundColor: "#141416",
								minWidth: "100%",
							}}
						>
							{filteredSuggestions.length === 0 ? (
								<div className="px-3 py-2 text-xs text-muted-foreground text-center">
									No matching suggestions
								</div>
							) : (
								<div className="flex flex-col gap-0.5" role="listbox">
									{filteredSuggestions.map((item) => (
										<button
											key={item}
											type="button"
											tabIndex={-1}
											onMouseDown={(e) => {
												// Prevent stealing focus from the input
												e.preventDefault();
											}}
											onClick={() => {
												onChange(item);
												setIsSuggestionsOpen(false);
											}}
											className={clsx(
												"w-full text-left px-2.5 py-1.5 text-xs rounded-md cursor-pointer flex items-center justify-between transition-colors",
												item === value
													? "bg-zinc-800 text-white font-medium"
													: "text-zinc-300 hover:text-white hover:bg-zinc-800/80 active:bg-zinc-700",
											)}
										>
											<span className="truncate">{item}</span>
											{item === value && (
												<span className="text-[12px] shrink-0 ml-1.5 font-bold text-lime-400">
													✓
												</span>
											)}
										</button>
									))}
								</div>
							)}
						</div>
					)}
				</div>
				{description && <Description>{description}</Description>}
			</TextField>

			<Popover
				isOpen={surface === "popover"}
				onOpenChange={(next) => {
					if (!next) closeSurface();
				}}
			>
				<Popover.Content
					className={clsx(
						popover.base(),
						"w-[var(--trigger-width)] rounded-xl",
					)}
					style={{
						width: "var(--trigger-width)",
					}}
					placement="bottom start"
					triggerRef={triggerRef}
				>
					<Popover.Dialog className={clsx(popover.dialog(), "p-3")}>
						{editor(
							POPOVER_ROWS,
							<Button
								aria-label="Expand editor"
								isIconOnly
								size="sm"
								variant="ghost"
								className="h-6 w-6 min-w-6 p-0"
								onPress={() => setSurface("modal")}
							>
								<FiMaximize2 />
							</Button>,
						)}
					</Popover.Dialog>
				</Popover.Content>
			</Popover>

			<Modal.Backdrop
				isOpen={surface === "modal"}
				onOpenChange={(next) => {
					if (!next) closeSurface();
				}}
			>
				<Modal.Container placement="center" size="md">
					<Modal.Dialog aria-label={title} className="p-4 rounded-xl">
						{editor(
							MODAL_ROWS,
							<Button
								aria-label="Shrink editor"
								isIconOnly
								size="sm"
								variant="ghost"
								className="h-6 w-6 min-w-6 p-0"
								onPress={() => setSurface("popover")}
							>
								<FiMinimize2 />
							</Button>,
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</>
	);
}


