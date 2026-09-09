import type { ReactNode } from "react";
import { useState } from "react";
import { Button, cn } from "@fluxify/components";
import { TbArrowLeft, TbArrowRight, TbCheck } from "react-icons/tb";

/**
 * The step-by-step create form the portal uses for anything with more than a
 * name to decide.
 *
 * The shape is lifted from the New Route page, which had it inline. A second
 * and third copy of a stepper is how three pages end up subtly different, so it
 * lives here now — the route page keeps its own until it is next touched.
 */

export type WizardStep = {
	key: string;
	/** Short label for the stepper. */
	label: string;
	/** Heading above the step's fields. */
	title: string;
	description: string;
	content: ReactNode;
	/** False keeps Next and Create disabled until the step is filled in. */
	isValid?: boolean;
};

export function FormWizard({
	title,
	description,
	onBack,
	steps,
	submitLabel,
	isPending,
	onSubmit,
}: {
	title: string;
	description: string;
	/** Where the arrow in the header goes — usually back to the list. */
	onBack: () => void;
	steps: WizardStep[];
	submitLabel: string;
	isPending?: boolean;
	onSubmit: () => void;
}) {
	const [step, setStep] = useState(0);
	// Steps appear and disappear as the form is filled in; never point past the end.
	const current = Math.min(step, steps.length - 1);
	const active = steps[current]!;
	const isLast = current === steps.length - 1;
	// A step nobody can complete must not be skipped past, so everything up to
	// and including the current one has to be valid before moving on.
	const canAdvance = steps.slice(0, current + 1).every((s) => s.isValid !== false);
	const canSubmit = steps.every((s) => s.isValid !== false);

	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
			<div className="flex items-center gap-3">
				<Button isIconOnly variant="ghost" aria-label="Back" onPress={onBack}>
					<TbArrowLeft size={18} />
				</Button>
				<div>
					<h1 className="text-xl font-semibold tracking-tight">{title}</h1>
					<p className="text-xs text-muted">{description}</p>
				</div>
			</div>

			<nav aria-label="Setup steps" className="border-b border-border pb-3">
				<ol className="flex flex-wrap gap-2">
					{steps.map((item, index) => {
						const reachable = index === 0 || canAdvance || index <= current;
						const complete = index < current;
						return (
							<li key={item.key} className="flex-1">
								<button
									type="button"
									disabled={!reachable}
									onClick={() => setStep(index)}
									aria-current={index === current ? "step" : undefined}
									className={cn(
										"flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs font-medium transition-colors",
										reachable
											? index === current
												? "text-foreground"
												: "text-muted hover:bg-surface-secondary hover:text-foreground"
											: "cursor-not-allowed text-muted/50",
									)}
								>
									<span
										className={cn(
											"flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-all",
											complete || index === current
												? "border-accent bg-accent text-accent-foreground"
												: "border-border bg-surface-secondary text-muted",
										)}
									>
										{complete ? <TbCheck size={12} strokeWidth={3} /> : index + 1}
									</span>
									<span className="hidden truncate sm:inline">{item.label}</span>
								</button>
							</li>
						);
					})}
				</ol>
			</nav>

			<div className="min-h-[340px]">
				<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
					Step {current + 1} of {steps.length}
				</p>
				<h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
					{active.title}
				</h2>
				<p className="mt-0.5 text-xs text-muted">{active.description}</p>
				<div className="mt-4">{active.content}</div>
			</div>

			<div className="flex items-center justify-between border-t border-border pt-3.5">
				<Button
					variant="ghost"
					size="sm"
					isDisabled={current === 0}
					onPress={() => setStep(current - 1)}
				>
					<TbArrowLeft size={16} /> Back
				</Button>
				{isLast ? (
					<Button
						variant="primary"
						size="sm"
						isPending={isPending}
						isDisabled={!canSubmit}
						onPress={onSubmit}
					>
						{submitLabel}
					</Button>
				) : (
					<div className="flex items-center gap-2">
						{canSubmit && (
							<Button
								variant="outline"
								size="sm"
								isPending={isPending}
								onPress={onSubmit}
							>
								{submitLabel}
							</Button>
						)}
						<Button
							variant="primary"
							size="sm"
							isDisabled={!canAdvance}
							onPress={() => setStep(current + 1)}
						>
							Next <TbArrowRight size={16} />
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}

/** One labelled value on a review step. */
export function SummaryItem({
	label,
	value,
	mono,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	return (
		<div className="bg-surface px-3 py-2">
			<dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
			<dd className={cn("mt-0.5 text-sm text-foreground", mono && "font-mono")}>
				{value || "—"}
			</dd>
		</div>
	);
}
