import type { SlashCommand } from "./slashCommands";

/** The suggestions under a lone `/` in the editor. Picking one fills the editor with `/name `. */
export function SlashPopover({
	commands,
	onPick,
}: {
	commands: readonly SlashCommand[];
	onPick: (c: SlashCommand) => void;
}) {
	return (
		<div
			role="listbox"
			aria-label="Commands"
			className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-full rounded-xl border border-border bg-overlay p-1 shadow-xl"
		>
			{commands.map((c, i) => (
				<button
					type="button"
					role="option"
					aria-selected={i === 0}
					key={c.name}
					onClick={() => onPick(c)}
					className={`flex w-full items-baseline gap-2 rounded-lg p-2 text-left text-sm transition-colors ${
						i === 0 ? "bg-accent/15 ring-1 ring-inset ring-accent/50" : "hover:bg-surface-secondary"
					}`}
				>
					<span className="font-medium text-foreground">/{c.name}</span>
					<span className="text-xs text-muted">{c.hint}</span>
					<span className="min-w-0 flex-1 truncate text-xs text-muted">{c.description}</span>
				</button>
			))}
		</div>
	);
}
