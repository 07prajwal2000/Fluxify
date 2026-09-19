import type { SpotlightCategory, SpotlightCommand } from "./types";

export type SpotlightFilterResult = {
	commands: SpotlightCommand[];
	mode: "all" | "goto" | "add";
};

const CATEGORY_ORDER: Record<SpotlightCategory, number> = {
	Actions: 1,
	Blocks: 2,
	Navigation: 3,
	Resources: 4,
	Help: 5,
};

function matchesTerm(command: SpotlightCommand, term: string): boolean {
	if (!term) return true;
	const cleanTerm = term.toLowerCase();
	const targets = [
		command.title,
		command.subtitle,
		command.description,
		command.category,
		...(command.keywords ?? []),
	];
	return targets.some((text) => text?.toLowerCase().includes(cleanTerm));
}

function matchScore(command: SpotlightCommand, term: string): number {
	if (!term) return 1;
	const clean = term.toLowerCase();
	let score = 0;
	if (command.title.toLowerCase().startsWith(clean)) score += 20;
	else if (command.title.toLowerCase().includes(clean)) score += 10;
	if (command.subtitle?.toLowerCase().includes(clean)) score += 5;
	if (command.keywords?.some((k) => k.toLowerCase().includes(clean))) score += 4;
	if (command.description?.toLowerCase().includes(clean)) score += 2;
	if (command.category.toLowerCase().includes(clean)) score += 1;
	return score;
}

export function filterSpotlightCommands(
	allCommands: SpotlightCommand[],
	query: string,
): SpotlightFilterResult {
	const trimmed = query.trim();

	// Goto mode: user explicitly typed `goto` or `goto ...`
	if (/^goto(\s|$)/i.test(trimmed)) {
		const term = trimmed.replace(/^goto\s*/i, "");
		const nav = allCommands.filter(
			(cmd) => cmd.category === "Navigation" && matchesTerm(cmd, term),
		);
		const resources = allCommands.filter(
			(cmd) => cmd.category === "Resources" && matchesTerm(cmd, term),
		);
		return {
			commands: [...nav, ...resources],
			mode: "goto",
		};
	}

	// Add block mode: user explicitly typed `add` or `add >` or `add ...`
	if (/^add(\s|>|$)/i.test(trimmed)) {
		const term = trimmed.replace(/^add(\s*>)?\s*/i, "");
		const blocks = allCommands.filter(
			(cmd) => (cmd.category === "Blocks" || cmd.id === "addNote") && matchesTerm(cmd, term),
		);
		return {
			commands: blocks,
			mode: "add",
		};
	}

	// Empty query: show Canvas Actions, quick jumps, list pages, and help
	if (!trimmed) {
		const defaultOrder: SpotlightCommand[] = [];
		const actions = allCommands.filter((cmd) => cmd.category === "Actions");
		const nav = allCommands.filter((cmd) => cmd.category === "Navigation");
		const help = allCommands.filter((cmd) => cmd.category === "Help");
		defaultOrder.push(...actions, ...nav, ...help);
		return {
			commands: defaultOrder,
			mode: "all",
		};
	}

	// General search across all commands with ranking
	const scored = allCommands
		.map((cmd) => ({ cmd, score: matchScore(cmd, trimmed) }))
		.filter((entry) => entry.score > 0);

	scored.sort((a, b) => {
		const catA = CATEGORY_ORDER[a.cmd.category] ?? 99;
		const catB = CATEGORY_ORDER[b.cmd.category] ?? 99;
		if (catA !== catB) return catA - catB;
		return b.score - a.score;
	});

	return {
		commands: scored.map((entry) => entry.cmd),
		mode: "all",
	};
}
