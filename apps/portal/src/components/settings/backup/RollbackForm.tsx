import { Checkbox } from "@fluxify/components";
import { TbAlertTriangle } from "react-icons/tb";
import { Section } from "@/components/common/Section";
import type { RollbackChoice, RollbackSummary } from "@/services/backups";
import { labelOf } from "./labels";

/** Rolling a project back in place (#1130): the choices and what they change. */

const MODES: Record<RollbackChoice["mode"], { title: string; body: string }> = {
	keep: {
		title: "Keep extras",
		body: "What the backup has comes back as it was. Anything added since stays.",
	},
	exact: {
		title: "Exact replica",
		body: "The sections you restore end up exactly as backed up: anything added since is removed.",
	},
};

/** every section the archive holds, keep extras, today's credentials */
export const defaultChoice = (summary: RollbackSummary): RollbackChoice => ({
	mode: "keep",
	sections: summary.rollback.sections.map((s) => s.section),
	restoreSecrets: false,
});

/** what stops the rollback with these choices: the same rule the server refuses by */
export const activeConflicts = (summary: RollbackSummary, choice: RollbackChoice) =>
	summary.rollback.conflicts.filter(
		(c) =>
			c.mode === choice.mode &&
			c.selected.every((s) => choice.sections.includes(s)) &&
			c.kept.every((s) => !choice.sections.includes(s)),
	);

/** what an exact replica removes, by section, for the confirm */
export const removals = (summary: RollbackSummary, choice: RollbackChoice) =>
	choice.mode !== "exact"
		? []
		: summary.rollback.sections.filter(
				(s) => choice.sections.includes(s.section) && s.extras.length > 0,
			);

export const choiceReady = (summary: RollbackSummary, choice: RollbackChoice) =>
	choice.sections.length > 0 && activeConflicts(summary, choice).length === 0;

function counts(s: RollbackSummary["rollback"]["sections"][number], exact: boolean) {
	if (s.replaced) return "Replaced with the backup's";
	const extras = s.extras.length ? `${s.extras.length} ${exact ? "removed" : "kept"}` : null;
	return [`${s.update.length} updated`, `${s.create.length} created`, extras]
		.filter(Boolean)
		.join(" · ");
}

export function RollbackForm({
	summary,
	choice,
	onChoice,
	isDisabled,
}: {
	summary: RollbackSummary;
	choice: RollbackChoice;
	onChoice: (choice: RollbackChoice) => void;
	isDisabled: boolean;
}) {
	const set = (patch: Partial<RollbackChoice>) => onChoice({ ...choice, ...patch });
	const toggle = (section: string, on: boolean) =>
		set({
			sections: on ? [...choice.sections, section] : choice.sections.filter((s) => s !== section),
		});
	const exact = choice.mode === "exact";
	const conflicts = activeConflicts(summary, choice);
	const template = summary.mode === "template";
	return (
		<Section
			title="Roll back this project"
			description="Matching is by name, section by section. A resource in both keeps its id, so its logs, runs and links stay valid. Before anything changes, a full backup of the project is taken (“Before rollback” in the history); if it fails, nothing changes."
		>
			<fieldset disabled={isDisabled} className="flex flex-col gap-4">
				<div role="radiogroup" aria-label="Rollback mode" className="grid gap-3 sm:grid-cols-2">
					{(Object.keys(MODES) as RollbackChoice["mode"][]).map((m) => (
						<button
							key={m}
							type="button"
							role="radio"
							aria-checked={choice.mode === m}
							onClick={() => set({ mode: m })}
							className={`flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors ${
								choice.mode === m
									? "border-accent bg-accent/10"
									: "border-border bg-surface hover:bg-surface-secondary"
							}`}
						>
							<span className="text-sm font-semibold text-foreground">{MODES[m].title}</span>
							<span className="text-xs text-muted">{MODES[m].body}</span>
						</button>
					))}
				</div>

				<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
					<p className="text-sm font-semibold text-foreground">What to restore</p>
					{summary.rollback.sections.map((s) => (
						<Checkbox
							key={s.section}
							isSelected={choice.sections.includes(s.section)}
							isDisabled={isDisabled}
							onChange={(on: boolean) => toggle(s.section, on)}
							label={labelOf(s.section)}
							description={counts(s, exact)}
						/>
					))}
					<hr className="border-border" />
					<Checkbox
						isSelected={!template && choice.restoreSecrets}
						isDisabled={isDisabled || template}
						onChange={(on: boolean) => set({ restoreSecrets: on })}
						label="Also restore credentials and values from the backup"
						description={
							template
								? "A template carries no credentials or values."
								: "Off: integrations and app config keys that exist keep today's credentials and values; missing ones are added."
						}
					/>
				</div>

				{conflicts.length > 0 && (
					<div
						role="alert"
						className="flex gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4"
					>
						<TbAlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
						<ul className="flex flex-col gap-1 text-sm text-foreground">
							{conflicts.map((c) => (
								<li key={c.message}>{c.message}</li>
							))}
						</ul>
					</div>
				)}
			</fieldset>
		</Section>
	);
}

/** the confirm's body: every resource an exact replica removes */
export function RemovalList({
	summary,
	choice,
}: {
	summary: RollbackSummary;
	choice: RollbackChoice;
}) {
	return (
		<div className="flex flex-col gap-2">
			<p>These are not in the backup and will be removed:</p>
			<ul className="flex flex-col gap-1">
				{removals(summary, choice).map((s) => (
					<li key={s.section}>
						<span className="font-medium text-foreground">{labelOf(s.section)}:</span>{" "}
						{s.extras.join(", ")}
					</li>
				))}
			</ul>
		</div>
	);
}
