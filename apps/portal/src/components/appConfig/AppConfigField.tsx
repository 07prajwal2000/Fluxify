import { useState } from "react";
import { Button, CloseButton, Label, cn } from "@fluxify/components";
import { TbKey, TbVariable } from "react-icons/tb";
import {
	type AppConfigExtraItem,
	AppConfigSelectorModal,
} from "@/components/integrations/AppConfigSelectorModal";

export type AppConfigFieldProps = {
	projectId: string;
	/** A bare app config key, or `param:<name>` when deferred to the caller. */
	value: string;
	label?: string;
	description?: string;
	placeholder?: string;
	isDisabled?: boolean;
	/** Input params of the enclosing custom block, offered as `param:` entries. */
	extraItems?: AppConfigExtraItem[];
	onChange: (value: string) => void;
};

/**
 * Picks an app config *key*. Unlike `integrations/AppConfigSelector`, this field
 * has no literal mode — a literal is exactly what an app config reference exists
 * to remove — so it stores the bare key with no `cfg:` marker to disambiguate.
 */
export function AppConfigField({
	projectId,
	value,
	label,
	description,
	placeholder = "None selected",
	isDisabled,
	extraItems,
	onChange,
}: AppConfigFieldProps) {
	const [pickerOpen, setPickerOpen] = useState(false);

	const isParam = value.startsWith("param:");
	const extra = isParam ? extraItems?.find((e) => e.value === value) : undefined;

	return (
		<div className="flex flex-col gap-1.5 py-2">
			{label && <Label>{label}</Label>}
			{description && (
				<p className="text-xs leading-normal text-muted-foreground">
					{description}
				</p>
			)}

			<div className="flex h-10 w-full items-center justify-between gap-3 rounded-[var(--radius)] border border-border bg-surface px-3 shadow-sm">
				<div className="flex min-w-0 flex-1 items-center gap-2.5">
					{value ? (
						<>
							{isParam ? (
								<TbVariable size={16} className="shrink-0 text-accent" />
							) : (
								<TbKey size={16} className="shrink-0 text-muted-foreground" />
							)}
							<span
								className={cn(
									"truncate font-mono text-sm font-medium",
									isParam ? "text-accent" : "text-foreground",
								)}
							>
								{isParam ? (extra?.label ?? value.slice(6)) : value}
							</span>
							{isParam && (
								<span className="shrink-0 rounded-full border border-border bg-surface-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
									Input parameter
								</span>
							)}
						</>
					) : (
						<span className="text-sm text-muted-foreground">{placeholder}</span>
					)}
				</div>

				<div className="flex shrink-0 items-center gap-1.5">
					{value && !isDisabled && (
						<>
							<CloseButton
								aria-label="Clear app config key"
								onPress={() => onChange("")}
								className="text-muted-foreground hover:text-foreground"
							/>
							<span className="mx-1 h-5 w-px shrink-0 bg-border" />
						</>
					)}
					<Button
						variant="primary"
						size="sm"
						isDisabled={isDisabled}
						onPress={() => setPickerOpen(true)}
					>
						{value ? "Change" : "Select"}
					</Button>
				</div>
			</div>

			{isParam && extra?.hint && (
				<p className="text-xs leading-normal text-accent">{extra.hint}</p>
			)}

			<AppConfigSelectorModal
				projectId={projectId}
				isOpen={pickerOpen}
				onOpenChange={setPickerOpen}
				selectedValue={value}
				extraItems={extraItems}
				onSelect={onChange}
				onClear={() => onChange("")}
			/>
		</div>
	);
}
