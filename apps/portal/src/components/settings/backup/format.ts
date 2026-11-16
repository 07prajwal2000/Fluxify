/** 1536 -> "1.5 KB" */
export function formatBytes(bytes: number | null) {
	if (bytes === null) return "—";
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** the README is limited in bytes, not characters */
export const byteLength = (text: string) => new TextEncoder().encode(text).length;

/** a plain anchor click: the browser downloads the archive, with the session cookie, and stays on the page */
export function triggerDownload(url: string) {
	const a = document.createElement("a");
	a.href = url;
	a.download = "";
	document.body.appendChild(a);
	a.click();
	a.remove();
}
