export type Theme = "dark" | "light";

export function getTheme(): Theme {
	if (typeof document === "undefined") return "dark";
	return document.documentElement.classList.contains("dark") ||
		document.documentElement.getAttribute("data-theme") === "dark"
		? "dark"
		: "light";
}

export function setTheme(theme: Theme): void {
	if (typeof document === "undefined") return;
	if (theme === "dark") {
		document.documentElement.classList.remove("light");
		document.documentElement.classList.add("dark");
		document.documentElement.setAttribute("data-theme", "dark");
	} else {
		document.documentElement.classList.remove("dark");
		document.documentElement.classList.add("light");
		document.documentElement.setAttribute("data-theme", "light");
	}
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
		if (saved === "light" || saved === "dark") {
			setTheme(saved);
		}
	} catch {}
}
