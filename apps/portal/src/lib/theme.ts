export type Theme = "dark" | "light";
/** What the user picked. "system" follows the OS setting. */
export type ThemePreference = Theme | "system";

export function getTheme(): Theme {
	if (typeof document === "undefined") return "dark";
	return document.documentElement.classList.contains("dark") ||
		document.documentElement.getAttribute("data-theme") === "dark"
		? "dark"
		: "light";
}

function systemTheme(): Theme {
	return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches
		? "light"
		: "dark";
}

function applyTheme(theme: Theme): void {
	const root = document.documentElement;
	root.classList.remove(theme === "dark" ? "light" : "dark");
	root.classList.add(theme);
	root.setAttribute("data-theme", theme);
}

/** The saved choice, or the theme on screen when nothing is saved yet. */
export function getThemePreference(): ThemePreference {
	try {
		const saved = localStorage.getItem("theme");
		if (saved === "light" || saved === "dark" || saved === "system") return saved;
	} catch {}
	return getTheme();
}

export function setTheme(theme: ThemePreference): void {
	if (typeof document === "undefined") return;
	applyTheme(theme === "system" ? systemTheme() : theme);
	if (typeof localStorage !== "undefined") {
		try {
			localStorage.setItem("theme", theme);
		} catch {}
	}
}

export function toggleTheme(): Theme {
	const current = getTheme();
	const next = current === "dark" ? "light" : "dark";
	setTheme(next);
	return next;
}

export function initTheme(): void {
	if (typeof localStorage === "undefined" || typeof document === "undefined") return;
	try {
		const saved = localStorage.getItem("theme");
		if (saved === "light" || saved === "dark" || saved === "system") {
			setTheme(saved);
		}
	} catch {}
	// Follow OS changes while the choice is "system".
	if (typeof matchMedia === "function") {
		matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => {
			if (getThemePreference() === "system") applyTheme(systemTheme());
		});
	}
}
