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
import { useCallback, useMemo, useRef, useState } from "react";
import { FiMaximize2, FiMinimize2, FiX } from "react-icons/fi";
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
}: JsTextFieldProps) {
	const triggerRef = useRef<HTMLDivElement>(null);
	const justClosedRef = useRef<boolean>(false);
	const [surface, setSurface] = useState<Surface>("closed");
	const [draft, setDraft] = useState("");
	const popover = useMemo(() => popoverVariants(), []);

	const isJs = !disableJs && isJsExpression(value);
	const title = label ? `${label} — JavaScript` : "JavaScript Expression";

	const open = useCallback(
		(next: Exclude<Surface, "closed">) => {
			if (isDisabled) return;
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
		if (!isJs || isDisabled) return;
		if (justClosedRef.current) return;
		if (surface === "closed") {
			open("popover");
		}
	}, [isJs, isDisabled, surface, open]);

	const handleInputKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (!isJs || isDisabled) return;
			if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
				e.preventDefault();
				if (surface === "closed" && !justClosedRef.current) {
					open("popover");
				}
			}
		},
		[isJs, isDisabled, surface, open],
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
				onChange={isJs ? undefined : onChange}
				value={isJs ? readExpression(value) : value}
				variant={variant}
			>
				{label && <Label>{label}</Label>}
				<div ref={triggerRef} className="w-full min-w-0">
					<InputGroup fullWidth={fullWidth} variant={variant} className="w-full min-w-0">
						<InputGroup.Input
							className={clsx(
								"min-w-0 flex-1",
								isJs && "font-mono text-xs cursor-pointer",
							)}
							onBlur={isJs ? undefined : onBlur}
							onClick={handleInputClick}
							onKeyDown={handleInputKeyDown}
							placeholder={isJs ? "JavaScript expression" : placeholder}
							readOnly={isJs}
						/>
						{!disableJs && (
							<InputGroup.Suffix className="shrink-0 gap-0.5 px-1.5">
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
							</InputGroup.Suffix>
						)}
					</InputGroup>
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
