import type { RouteBundle } from "@/services/routes";

export const ROUTE_FILE_EXTENSION = ".fluxroute";
const ROUTE_FILE_MIME = "application/json";

/** `fluxify-route-list-users-2026-10-29.fluxroute` */
export function routeFilename(name: string): string {
	const slug =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || "route";
	return `fluxify-route-${slug}-${new Date().toISOString().slice(0, 10)}${ROUTE_FILE_EXTENSION}`;
}

/** Hands the bundle to the browser as a download. */
export function downloadRouteFile(bundle: RouteBundle, filename: string): void {
	const url = URL.createObjectURL(
		new Blob([JSON.stringify(bundle, null, 2)], { type: ROUTE_FILE_MIME }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	// Revoking synchronously can beat the download in some browsers.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Opens the file picker. Resolves `null` when the user cancels. */
export function pickRouteFile(): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = `${ROUTE_FILE_EXTENSION},${ROUTE_FILE_MIME}`;
		input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
		input.addEventListener("cancel", () => resolve(null));
		input.click();
	});
}

/** Reads a picked file. The server checks the contents; this only refuses what is not JSON. */
export async function readRouteFile(file: File): Promise<RouteBundle> {
	try {
		return JSON.parse(await file.text());
	} catch {
		throw new Error("That file isn't a Fluxify route export.");
	}
}
