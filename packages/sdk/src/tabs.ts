/** the tab a param without `tab` shows in */
export const GENERAL_TAB = "General";

type Placed = { type: string; tab?: string; order?: number };
export type ParamTab = { name: string; params: string[] };

/**
 * The settings panel's tabs, in order, each with its params (hints included)
 * in order. General comes first unless `tabs` places it, then the tabs in
 * `tabs`, then any other in order of first use. Within a tab, params with an
 * `order` come first by it, the rest in declaration order (a stable sort). The
 * CLI writes the result into the manifest and the portal reads it back, so an
 * old manifest without tabs is one General tab.
 */
export function paramTabs(params: Record<string, Placed>, tabs?: readonly string[]): ParamTab[] {
	const entries = Object.entries(params);
	const tabOf = (p: Placed) => p.tab ?? GENERAL_TAB;
	const used = entries.map(([, p]) => tabOf(p));
	const lead = used.includes(GENERAL_TAB) && !tabs?.includes(GENERAL_TAB) ? [GENERAL_TAB] : [];
	const names = [...new Set([...lead, ...(tabs ?? []), ...used])];
	return names.map((name) => ({
		name,
		params: entries
			.filter(([, p]) => tabOf(p) === name)
			.sort(([, a], [, b]) => (a.order ?? Infinity) - (b.order ?? Infinity))
			.map(([key]) => key),
	}));
}
