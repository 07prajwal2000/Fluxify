import { Button, Checkbox } from "@fluxify/components";
import { useState } from "react";
import { TbNotes } from "react-icons/tb";
import type { BackupMode, BackupSection } from "@/services/backups";
import { dependencyHint, labelOf, MODE_COPY, SECTION_LABELS } from "./labels";
import { ReadmeField } from "./ReadmeField";

/** what the Back up tab edits; the state lives in `BackupSettings` so the Schedule tab sees it too */
export interface BackupFormState {
	sections: BackupSection[];
	ticked: Set<string>;
	onToggle: (name: string, on: boolean) => void;
	mode: BackupMode;
	onMode: (mode: BackupMode) => void;
	versionHistory: boolean;
	onVersionHistory: (on: boolean) => void;
	appConfigValues: boolean;
	onAppConfigValues: (on: boolean) => void;
	readme: string;
	onReadme: (text: string) => void;
}

/** Project settings > Backup > Back up (#1103): what goes in the archive. Download is in the header. */
export function BackupForm(f: BackupFormState) {
	const template = f.mode === "template";
	const [readmeOpen, setReadmeOpen] = useState(false);
	// once there is text the field stays open, even if the user then clears it
	if (f.readme && !readmeOpen) setReadmeOpen(true);

	return (
		<div className="flex flex-col gap-4">
			<div role="radiogroup" aria-label="Kind of archive" className="grid gap-3 sm:grid-cols-2">
				{(Object.keys(MODE_COPY) as BackupMode[]).map((m) => (
					<button
						key={m}
						type="button"
						role="radio"
						aria-checked={f.mode === m}
						onClick={() => f.onMode(m)}
						className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${
							f.mode === m
								? "border-accent bg-accent/10"
								: "border-border bg-surface hover:bg-surface-secondary"
						}`}
					>
						<span className="text-sm font-semibold text-foreground">{MODE_COPY[m].title}</span>
						<span className="text-xs text-muted">{MODE_COPY[m].body}</span>
					</button>
				))}
			</div>

			<fieldset className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
				<legend className="px-1 text-sm font-semibold text-foreground">What to include</legend>
				<div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
					{f.sections.map(({ name }) => {
						const hint = dependencyHint(name, f.ticked, f.sections);
						return (
							<div
								key={name}
								className="flex flex-col gap-1"
								title={SECTION_LABELS[name]?.description}
							>
								<Checkbox
									isSelected={f.ticked.has(name)}
									onChange={(on: boolean) => f.onToggle(name, on)}
									label={labelOf(name)}
								/>
								{hint && (
									<p role="note" className="pl-7 text-xs text-warning">
										{hint}
									</p>
								)}
							</div>
						);
					})}
				</div>
				<hr className="border-border" />
				<div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
					<Checkbox
						isSelected={f.versionHistory}
						onChange={(on: boolean) => f.onVersionHistory(on)}
						label="Canvas version history"
						description="Every committed version, not only the live one. Larger archive."
					/>
					<Checkbox
						isSelected={!template && f.appConfigValues}
						isDisabled={template}
						onChange={(on: boolean) => f.onAppConfigValues(on)}
						label="App config values"
						description={
							template
								? "A template never carries values, only the names."
								: "The values too, not only the names. They are encrypted in the archive."
						}
					/>
				</div>
			</fieldset>

			{readmeOpen ? (
				<ReadmeField value={f.readme} onChange={f.onReadme} highlight={template} />
			) : (
				<div>
					<Button variant="ghost" size="sm" onPress={() => setReadmeOpen(true)}>
						<TbNotes size={16} />
						Add a README
					</Button>
				</div>
			)}
		</div>
	);
}
