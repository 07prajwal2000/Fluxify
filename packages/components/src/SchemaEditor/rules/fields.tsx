import { InputGroup, Label, TextField } from "@heroui/react";
import type { ReactNode } from "react";

interface BaseFieldProps {
	label: string;
	placeholder?: string;
	description?: ReactNode;
	isReadOnly?: boolean;
}

function FieldShell({
	label,
	description,
	children,
}: {
	label: string;
	description?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex w-full flex-col gap-1.5">
			<Label className="text-xs font-medium text-muted-foreground">{label}</Label>
			{children}
			{description && <p className="text-xs text-muted">{description}</p>}
		</div>
	);
}

export function RuleTextField({
	label,
	placeholder,
	description,
	isReadOnly,
	value,
	onChange,
}: BaseFieldProps & {
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<FieldShell label={label} description={description}>
			<TextField fullWidth isDisabled={isReadOnly} variant="secondary">
				<InputGroup fullWidth variant="secondary">
					<InputGroup.Input
						aria-label={label}
						onChange={(event) => onChange(event.currentTarget.value)}
						placeholder={placeholder}
						value={value}
					/>
				</InputGroup>
			</TextField>
		</FieldShell>
	);
}

/**
 * A number rule that can also be *absent*. An empty input clears the rule
 * rather than writing `0`, which is a real bound the parser would enforce.
 */
export function RuleNumberField({
	label,
	placeholder,
	description,
	isReadOnly,
	value,
	onChange,
	min,
	step,
}: BaseFieldProps & {
	value: number | "";
	onChange: (value: number | "") => void;
	min?: number;
	step?: number;
}) {
	return (
		<FieldShell label={label} description={description}>
			<TextField fullWidth isDisabled={isReadOnly} variant="secondary">
				<InputGroup fullWidth variant="secondary">
					<InputGroup.Input
						aria-label={label}
						min={min}
						onChange={(event) => {
							const raw = event.currentTarget.value;
							if (raw === "") return onChange("");
							const next = Number(raw);
							if (Number.isFinite(next)) onChange(next);
						}}
						placeholder={placeholder}
						step={step}
						type="number"
						value={value === "" ? "" : String(value)}
					/>
				</InputGroup>
			</TextField>
		</FieldShell>
	);
}

export function RuleSectionTitle({ children }: { children: ReactNode }) {
	return (
		<p className="text-sm font-semibold text-foreground">{children}</p>
	);
}
